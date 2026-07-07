# GitHub 加速

> GitHub release、archive、raw、gist 等资源加速，基于 Cloudflare Pages Workers。

## 演示

- 主站：https://gh.996855.xyz/
- 备站：https://pip.996855.xyz/

两个域名均部署在 Cloudflare Pages，自动选择延迟最低的边缘节点。
大量使用请自行部署，公共服务不承担稳定性保障。

## 功能

- 支持 release / archive / raw / blob / gist 链接代理
- Range 请求透传，断点续传可用
- 边缘缓存命中相同资源，节省 GitHub API 配额
- 自动跟随 3xx 重定向，对 release → S3 链路透明
- 完整 CORS 头，浏览器 fetch/curl/git clone 均可用

## 合法输入示例

> 文件不存在仅为示例

- 分支源码：`https://github.com/user/project/archive/master.zip`
- release 源码：`https://github.com/user/project/archive/v0.1.0.tar.gz`
- release 文件：`https://github.com/user/project/releases/download/v0.1.0/example.zip`
- 分支文件：`https://github.com/user/project/blob/master/filename`
- commit 文件：`https://github.com/user/project/blob/<sha>/filename`
- gist：`https://gist.githubusercontent.com/user/<id>/raw/cmd.py`
- git clone：`https://USER:TOKEN@gh.996855.xyz/https://github.com/user/project`（私有仓库）

## 部署

### Cloudflare Pages

1. 打开 https://pages.cloudflare.com/ ，登录后 `Create application` → `Direct Upload`
2. 把仓库根目录的 `_worker.js` 和 `index.html` 上传
3. 在 `Settings → Environment variables` 配置：
   - `ASSET_URL`：`https://你的pages域名/` （静态首页 URL）
   - `PREFIX`：`/` （自定义子路径时改为 `/gh/` 这种）

### 路由

| 访问方式 | 行为 |
|---------|------|
| `https://gh.996855.xyz/` | 访问首页（静态资源） |
| `https://gh.996855.xyz/?q=<github_url>` | 代理 GitHub 链接 |
| `https://gh.996855.xyz/<github_url>` | 同上（路径式） |

## 本地调试

```bash
npm install -g wrangler
wrangler pages dev ./
```

## 计费参考

Cloudflare Workers 免费额度：
- 每天 10 万次请求
- 每分钟 1000 次请求

超出后升级为 $5/月套餐，包含每月 1000 万次请求。
边缘缓存命中不计费（仅产生校验请求）。

## 致谢

基于开源项目 [hunshcn/gh-proxy](https://github.com/hunshcn/gh-proxy) 二次开发，
原项目采用 MIT 协议。

## License

MIT