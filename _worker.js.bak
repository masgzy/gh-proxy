// _worker.js
export default {
    async fetch(request, env) {
        'use strict';

        const ASSET_URL = env.ASSET_URL || 'https://hunshcn.github.io/gh-proxy/';
        const PREFIX = env.PREFIX || '/';
        const Config = { jsdelivr: env.jsdelivr || 0 };
        
        // 正则表达式集（保持原样）
        const exp1 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:releases|archive)\/.*$/i;
        const exp2 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:blob|raw)\/.*$/i;
        const exp3 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:info|git-).*$/i;
        const exp4 = /^(?:https?:\/\/)?raw\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+?\/.+$/i;
        const exp5 = /^(?:https?:\/\/)?gist\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+$/i;
        const exp6 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/tags.*$/i;

        // 核心处理逻辑
        const url = new URL(request.url);
        let path = url.searchParams.get('q') || 
                  url.pathname.replace(new RegExp(`^${PREFIX}`), '');

        // 重定向处理
        if (url.searchParams.has('q')) {
            return Response.redirect(`https://${url.host}${PREFIX}${path}`, 301);
        }

        // 路径匹配逻辑
        if ([exp1, exp5, exp6, exp3, exp4].some(exp => path.match(exp))) {
            return handleProxy(request, path, Config);
        } else if (path.match(exp2)) {
            const newPath = Config.jsdelivr ? 
                path.replace('/blob/', '@').replace(/^github\.com/, 'cdn.jsdelivr.net/gh') :
                path.replace('/blob/', '/raw/');
            return Response.redirect(newPath, 302);
        }

        // 静态资源回退
        return fetch(`${ASSET_URL}${path}`);
    }
};

// 代理处理函数
async function handleProxy(request, path, config) {
    const init = {
        method: request.method,
        headers: new Headers(request.headers),
        redirect: 'manual'
    };
    
    const targetUrl = path.startsWith('http') ? path : `https://${path}`;
    const response = await fetch(targetUrl, init);
    
    // 响应头处理
    const newHeaders = new Headers(response.headers);
    newHeaders.set('access-control-allow-origin', '*');
    newHeaders.delete('content-security-policy');
    
    return new Response(response.body, {
        status: response.status,
        headers: newHeaders
    });
}
