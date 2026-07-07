// _worker.js — Cloudflare Pages 入口（精简优化版）
//
// 核心职责：代理 GitHub release/archive/raw/blob/gist 文件下载
// 优化点：
//   1) 剥离 Cloudflare 平台响应头，保留 GitHub 业务头
//   2) 边缘 Cache API 复用 GitHub 公开资源
//   3) AbortController 超时 + 单次重试
//   4) 链式重定向解析后单次 fetch（省 RTT）
//   5) 严格 URL 校验（拒绝 ..、超长、非法字符）

// ============ 预编译正则 ============
const PATTERNS = Object.freeze([
    /^(?:https?:\/\/)?github\.com\/[^\/]+\/[^\/]+\/(?:releases|archive)\/.*$/i,
    /^(?:https?:\/\/)?github\.com\/[^\/]+\/[^\/]+\/(?:blob|raw)\/.*$/i,
    /^(?:https?:\/\/)?github\.com\/[^\/]+\/[^\/]+\/(?:info|git-).*$/i,
    /^(?:https?:\/\/)?raw\.(?:githubusercontent|github)\.com\/[^\/]+\/[^\/]+\/[^\/]+\/.*$/i,
    /^(?:https?:\/\/)?gist\.(?:githubusercontent|github)\.com\/[^\/]+\/[^\/]+\/.*$/i,
    /^(?:https?:\/\/)?github\.com\/[^\/]+\/[^\/]+\/tags.*$/i,
]);

const BLOB_RAW_RE = /\/(?:blob|raw)\//i;
const PROTOCOL_RE = /^https?:\/\//i;
const GITHUB_DOMAIN_RE = /^github\.com\//i;
const INVALID_PATH_RE = /\.\.|^\/|^[a-z]:\\/i;

// 需剥离的 Cloudflare 平台头 + 安全策略头
const STRIP_HEADERS = new Set([
    'server',
    'cf-ray',
    'cf-cache-status',
    'cf-worker',
    'cf-request-id',
    'cf-connecting-ip',
    'cf-ew-via',
    'cf-bgj',
    'cf-polished',
    'cf-apo-via',
    'cf-cache-tier',
    'cf-cache-device-type',
    'cf-edge-cache',
    'cf-mirror',
    'expect-ct',
    'report-to',
    'nel',
    'content-security-policy',
    'content-security-policy-report-only',
    'x-content-type-options',
    'x-frame-options',
    'strict-transport-security',
    'x-xss-protection',
]);

// 透传给上游的请求头白名单
const REQ_HEADER_ALLOW = new Set([
    'user-agent',
    'accept',
    'accept-encoding',
    'accept-language',
    'authorization',
]);

const FETCH_TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 5;
const MAX_PATH_LEN = 2048;

// ============ 入口 ============
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const prefix = env.PREFIX || '/';

        let path = url.searchParams.get('q');
        if (!path) {
            path = stripPrefix(url.pathname, prefix);
        }

        if (!path) {
            return fetchAssets(request, env);
        }

        if (path.length > MAX_PATH_LEN || INVALID_PATH_RE.test(path)) {
            return new Response('Bad Request', { status: 400 });
        }

        if (PATTERNS.some(re => re.test(path))) {
            return handleProxy(request, ctx, path);
        }

        return fetchAssets(request, env);
    },
};

// ============ 核心代理 ============
async function handleProxy(request, ctx, path) {
    const cache = caches.default;
    const targetUrl = buildTargetUrl(path);

    // 边缘缓存：仅缓存 GET（GitHub 公开资源静态友好）
    const isCacheable = request.method === 'GET';
    let response = null;

    if (isCacheable) {
        const cacheKey = new Request(targetUrl, { method: 'GET', headers: request.headers });
        const cached = await cache.match(cacheKey);
        if (cached) {
            return patchResponse(cached, /*fromCache*/ true);
        }
    }

    // 构造上游请求头（白名单透传）
    const reqHeaders = new Headers();
    for (const [k, v] of request.headers.entries()) {
        if (REQ_HEADER_ALLOW.has(k.toLowerCase())) reqHeaders.set(k, v);
    }
    // 兜底 UA，避免被 S3 当作异常请求拒掉
    if (!reqHeaders.has('user-agent')) {
        reqHeaders.set('user-agent', 'Mozilla/5.0 (compatible; gh-proxy/2.0)');
    }
    // S3 要求带 Accept-Encoding 才返回压缩
    if (!reqHeaders.has('accept-encoding')) {
        reqHeaders.set('accept-encoding', 'gzip, deflate, br');
    }

    const init = {
        method: request.method,
        headers: reqHeaders,
        redirect: 'manual',
    };
    if (!['GET', 'HEAD'].includes(request.method)) {
        init.body = request.body;
    }

    // 链式重定向：递归解析 Location，最终只 fetch 一次
    let currentUrl = targetUrl;
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
        response = await fetchWithRetry(currentUrl, init);
        if (!isRedirect(response.status)) break;
        const loc = response.headers.get('location');
        try { await response.body?.cancel?.(); } catch {}
        if (!loc) break;
        try {
            currentUrl = new URL(loc, currentUrl).href;
        } catch {
            return new Response('Bad Redirect', { status: 502 });
        }
    }
    if (!response || isRedirect(response.status)) {
        return new Response('Too Many Redirects', { status: 508 });
    }

    // 写缓存（GET + 200 才缓存）
    if (isCacheable && response.status === 200) {
        const cacheKey = new Request(targetUrl, { method: 'GET', headers: request.headers });
        const copy = new Response(response.body, {
            status: response.status,
            headers: response.headers,
        });
        ctx.waitUntil(cache.put(cacheKey, copy));
    }

    return patchResponse(response, false);
}

// ============ 带超时和重试的 fetch ============
async function fetchWithRetry(url, init) {
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
        try {
            const res = await fetch(url, { ...init, signal: ctrl.signal });
            clearTimeout(t);
            return res;
        } catch (e) {
            clearTimeout(t);
            lastErr = e;
            await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
        }
    }
    throw lastErr || new Error('fetch failed');
}

// ============ 工具 ============
function patchResponse(response, fromCache) {
    const headers = new Headers(response.headers);

    // 剥 CF 平台头 + 安全策略头
    for (const name of STRIP_HEADERS) {
        if (headers.has(name)) headers.delete(name);
    }
    // 自定义标识
    headers.set('x-proxy-by', 'gh-proxy');
    headers.set('x-proxy-cache', fromCache ? 'HIT' : 'MISS');
    // CORS
    headers.set('access-control-allow-origin', '*');
    headers.set('access-control-expose-headers', 'content-length, etag, last-modified');

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}

function buildTargetUrl(path) {
    // blob / raw → raw.githubusercontent.com
    if (BLOB_RAW_RE.test(path)) {
        const cleanPath = path
            .replace(PROTOCOL_RE, '')
            .replace(GITHUB_DOMAIN_RE, '')
            .replace(BLOB_RAW_RE, '/');
        return `https://raw.githubusercontent.com/${cleanPath}`;
    }
    return path.startsWith('http') ? path : `https://${path}`;
}

function isRedirect(status) {
    return status >= 300 && status <= 399 && status !== 304;
}

function stripPrefix(pathname, prefix) {
    if (!prefix || prefix === '/' || prefix === '') {
        return pathname.replace(/^\/+/, '');
    }
    const norm = prefix.endsWith('/') ? prefix : prefix + '/';
    return pathname.startsWith(norm) ? pathname.slice(norm.length) : pathname;
}

async function fetchAssets(request, env) {
    try {
        return await env.ASSETS.fetch(request);
    } catch {
        return new Response('Not Found', { status: 404 });
    }
}