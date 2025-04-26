// _worker.js
export default {
    async fetch(request, env) {
        'use strict';

        const ASSET_URL = env.ASSET_URL || 'https://hunshcn.github.io/gh-proxy/';
        const PREFIX = env.PREFIX || '/';

        // 移除 jsdelivr 配置
        // const Config = { jsdelivr: env.jsdelivr || 0 }; // 已删除

        // 正则表达式集（保持原样）
        const exp1 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:releases|archive)\/.*$/i;
        const exp2 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:blob|raw)\/.*$/i;
        const exp3 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:info|git-).*$/i;
        const exp4 = /^(?:https?:\/\/)?raw\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+?\/.+$/i;
        const exp5 = /^(?:https?:\/\/)?gist\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+$/i;
        const exp6 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/tags.*$/i;

        const url = new URL(request.url);
        let path = url.searchParams.get('q') || 
                  url.pathname.replace(new RegExp(`^${PREFIX}`), '');

        // 移除重定向逻辑，直接处理所有匹配请求
        if ([exp1, exp2, exp5, exp6, exp3, exp4].some(exp => path.match(exp))) {
            return handleProxy(request, path);
        }

        // 静态资源回退
        return fetch(`${ASSET_URL}${path}`);
    }
};

async function handleProxy(request, path) {
    let targetUrl;

    // 处理不同路径模式
    if (path.match(/(?:blob|raw)\//i)) {
        // 处理 GitHub blob/raw 路径
        const [domain, ...rest] = path.split('/');
        const repoPath = rest.join('/').replace(/\/(blob|raw)\//, '/');

        // 直接使用 raw.githubusercontent.com
        targetUrl = `https://raw.githubusercontent.com/${repoPath}`;
    } else {
        // 其他模式直接构造目标 URL
        targetUrl = path.startsWith('http') 
            ? path 
            : `https://${path}`;
    }

    // 构造请求
    const init = {
        method: request.method,
        headers: new Headers(request.headers),
        redirect: 'manual' // 关键：阻止自动重定向
    };

    // 处理重定向逻辑
    let response = await fetch(targetUrl, init);
    let finalResponse = await followRedirects(response, targetUrl, init);

    // 处理响应头
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
        headers: newHeaders
    });
}

// 递归处理重定向（保持原样）
async function followRedirects(response, originalUrl, init) {
    if (!isRedirect(response.status)) {
        return response;
    }

    const location = response.headers.get('Location');
    if (!location) {
        return response;
    }

    // 构造新请求URL
    const newUrl = new URL(location, originalUrl);
    const newRequest = new Request(newUrl.href, init);

    // 递归处理
    const newResponse = await fetch(newRequest, init);
    return await followRedirects(newResponse, newUrl.href, init);
}

function isRedirect(status) {
    return status >= 300 && status <= 399 && status !== 304;
}