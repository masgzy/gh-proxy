// _worker.js — Cloudflare Pages 入口（优化版）

// ============ 预编译正则（模块级，只创建一次） ============
const PATTERNS = Object.freeze([
    /^(?:https?:\/\/)?github\.com\/[^\/]+\/[^\/]+\/(?:releases|archive)\/.*$/i,
    /^(?:https?:\/\/)?github\.com\/[^\/]+\/[^\/]+\/(?:blob|raw)\/.*$/i,
    /^(?:https?:\/\/)?github\.com\/[^\/]+\/[^\/]+\/(?:info|git-).*$/i,
    /^(?:https?:\/\/)?raw\.(?:githubusercontent|github)\.com\/[^\/]+\/[^\/]+\/[^\/]+\/.*$/i,
    /^(?:https?:\/\/)?gist\.(?:githubusercontent|github)\.com\/[^\/]+\/[^\/]+\/.*$/i,
    /^(?:https?:\/\/)?github\.com\/[^\/]+\/[^\/]+\/tags.*$/i,
]);

const BLOB_RAW_RE = /\/(?:blob|raw)\//i;
const PROTOCOL_RE = /^https?:\/\//;
const GITHUB_DOMAIN_RE = /^github\.com\//;

// 需要剥离的安全响应头
const STRIP_HEADERS = [
    'content-security-policy',
    'content-security-policy-report-only',
    'x-content-type-options',
    'x-frame-options',
    'strict-transport-security',
    'x-xss-protection',
];

// ============ 入口 ============
export default {
    async fetch(request, env) {
        const prefix = env.PREFIX || '/';
        const url = new URL(request.url);

        // 提取目标路径：优先 query 参数，其次去掉 prefix 的 pathname
        let path = url.searchParams.get('q');
        if (!path) {
            path = stripPrefix(url.pathname, prefix);
        }

        // 快速路径：空路径直接走静态资源
        if (!path) {
            return fetchAssets(request, env);
        }

        // 判断是否需要代理（预编译正则，test 比 match 快）
        if (PATTERNS.some(re => re.test(path))) {
            return handleProxy(request, path);
        }

        return fetchAssets(request, env);
    }
};

// ============ 核心代理逻辑 ============
async function handleProxy(request, path) {
    const targetUrl = buildTargetUrl(path);

    const init = {
        method: request.method,
        headers: request.headers,
        redirect: 'manual',
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    };

    // 循环处理重定向（替代递归，避免栈溢出）
    let response = await fetch(targetUrl, init);
    let currentUrl = targetUrl;

    while (isRedirect(response.status)) {
        const location = response.headers.get('location');
        if (!location) break;
        currentUrl = new URL(location, currentUrl).href;
        response = await fetch(currentUrl, init);
    }

    // 构造响应头
    const headers = new Headers(response.headers);
    headers.set('access-control-allow-origin', '*');
    for (const name of STRIP_HEADERS) {
        headers.delete(name);
    }

    return new Response(response.body, {
        status: response.status,
        headers,
    });
}

// ============ 工具函数 ============

function buildTargetUrl(path) {
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
    if (prefix === '/' || prefix === '') return pathname.replace(/^\//, '');
    return pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname;
}

async function fetchAssets(request, env) {
    try {
        return await env.ASSETS.fetch(request);
    } catch {
        return new Response('Not Found', { status: 404 });
    }
}
