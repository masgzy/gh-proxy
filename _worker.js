// _worker.js  (Cloudflare Pages 入口)
export default {
    async fetch(request, env) {
        'use strict';

        const PREFIX = env.PREFIX || '/';

        const exp1 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:releases|archive)\/.*$/i;
        const exp2 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:blob|raw)\/.*$/i;
        const exp3 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:info|git-).*$/i;
        const exp4 = /^(?:https?:\/\/)?raw\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+?\/.+$/i;
        const exp5 = /^(?:https?:\/\/)?gist\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+$/i;
        const exp6 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/tags.*$/i;

        const url = new URL(request.url);
        const path = url.searchParams.get('q') ||
                     url.pathname.replace(new RegExp(`^${PREFIX}`), '');

        // 命中代理规则 → 走代理
        if ([exp1, exp2, exp5, exp6, exp3, exp4].some(exp => path.match(exp))) {
            return handleProxy(request, path);
        }

        // 兜底:用 Pages 静态资源(项目根目录的 index.html / 其他静态文件)
        try {
            return await env.ASSETS.fetch(request);
        } catch (e) {
            return new Response('Not Found', { status: 404 });
        }
    }
};

async function handleProxy(request, path) {
    let targetUrl;

    if (path.match(/(?:blob|raw)\//i)) {
        // 处理 GitHub blob/raw 路径 → 直接走 raw.githubusercontent.com
        const [domain, ...rest] = path.split('/');
        const repoPath = rest.join('/').replace(/\/(blob|raw)\//, '/');
        targetUrl = `https://raw.githubusercontent.com/${repoPath}`;
    } else {
        targetUrl = path.startsWith('http')
            ? path
            : `https://${path}`;
    }

    const init = {
        method: request.method,
        headers: new Headers(request.headers),
        redirect: 'manual',
    };

    let response = await fetch(targetUrl, init);
    let finalResponse = await followRedirects(response, targetUrl, init);

    const newHeaders = new Headers(finalResponse.headers);
    newHeaders.set('access-control-allow-origin', '*');
    newHeaders.delete('content-security-policy');
    newHeaders.delete('content-security-policy-report-only');
    newHeaders.delete('x-content-type-options');
    newHeaders.delete('x-frame-options');
    newHeaders.delete('strict-transport-security');
    newHeaders.delete('x-xss-protection');

    return new Response(finalResponse.body, {
        status: finalResponse.status,
        headers: newHeaders,
    });
}

async function followRedirects(response, originalUrl, init) {
    if (!isRedirect(response.status)) {
        return response;
    }

    const location = response.headers.get('Location');
    if (!location) {
        return response;
    }

    const newUrl = new URL(location, originalUrl);
    const newRequest = new Request(newUrl.href, init);

    const newResponse = await fetch(newRequest, init);
    return await followRedirects(newResponse, newUrl.href, init);
}

function isRedirect(status) {
    return status >= 300 && status <= 399 && status !== 304;
}