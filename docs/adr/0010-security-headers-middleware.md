# ADR-0010: Production Security Headers Middleware

- **Status**: Accepted
- **Date**: 2026-05-07
- **Supersedes**: —
- **Related**: deploy.md（nginx TLS 终结）

## Context

v0.8.0 `deploy.md` 已经写明 production 用 nginx 端做 TLS 终结，但 FastAPI
本身没有任何安全响应头：浏览器吃到的 production 响应缺 HSTS / CSP /
X-Frame-Options 等保护——典型攻击面：

- **协议降级**：用户首次访问 `http://...` 后被中间人劫持到 https→http。
- **iframe 钓鱼**：站点可被任意页面嵌入 iframe。
- **XSS**：v0.8.7 起前端引入 Cloudflare Turnstile 第三方脚本，缺乏 CSP
  会让任意注入脚本无差别执行。

deploy.md 给的 nginx 例子里可以加 `add_header`，但这把责任留给
ops，应用本身没保障（dev 用 uvicorn 直跑、staging 不走 nginx 时彻底
裸奔）。把头部下沉到 FastAPI middleware 才是 single source of truth。

## Decision

**新增 production-only middleware** `app/middleware/security_headers.py`：

| Header | Value | 理由 |
|---|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | 1 年 + 子域，preload 留待运维评估后追加。 |
| `X-Content-Type-Options` | `nosniff` | 禁止浏览器 MIME sniff，防 XSS via type confusion。 |
| `X-Frame-Options` | `DENY` | 旧浏览器 fallback。 |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | 跨站只送 origin、同站完整 referrer。 |
| `Content-Security-Policy` | 见下文 | 限制脚本 / 样式 / 资源源。 |

**注册**：`environment == "production"` 才注册；dev / staging 跳过，
避免本地热更新被 inline script 打挂、docs-site 被 frame 限制。

**注册顺序**：在 `CORSMiddleware` 之前 `add_middleware`（FastAPI 后注册先执行→
SecurityHeaders 是栈底，dispatch 后写入响应时是最外层）→ CORS 头与
SecurityHeaders 头能并存。

### CSP 基线版本

```
default-src 'self';
img-src 'self' data: blob: https:;
style-src 'self' 'unsafe-inline';
script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com;
frame-src https://challenges.cloudflare.com;
connect-src 'self' https: wss: ws:;
font-src 'self' data:;
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none'
```

**当前折衷**：

- `style-src 'unsafe-inline'`：前端运行时仍有部分 inline style（emotion
  等 CSS-in-JS、第三方库）。strict 之前需要先排查全量 inline。
- `script-src 'unsafe-inline'`：Vite-built bundle 中部分 polyfill /
  HMR shim 使用 inline，先 baseline 通过；下一阶段切到 nonce-based。
- `https://challenges.cloudflare.com`：Turnstile widget（CAPTCHA）的
  script + frame-src，硬编码而非通配。
- `connect-src` 包括 `wss:` `ws:`：notification socket 与未来 ML
  backend 直连保留弹性。

`/metrics` 由独立 ASGI 子应用挂载（main.py），不经过本中间件——这是
有意设计：Prometheus 内网 scrape 不需要 HSTS / CSP。

## Consequences

**正向：**

- production 响应自带防护，运维 nginx 配置出错也有兜底。
- 单一来源更新（改 middleware 即覆盖所有 service），不需要在 deploy.md
  里维护一份 nginx snippet 副本。
- dev / staging 完全无影响（`if settings.environment == "production"`
  包裹）。

**负向 / 风险：**

- CSP 当前为「宽松基线」，不等于 strict 防御；XSS 攻击面只缩窄到「不允许
  跨域加载脚本」。下一阶段需要 nonce-based 收紧。
- 若新增第三方依赖（如 Sentry CDN、Google Fonts、第三方 ML backend
  iframe）需要同步更新 CSP，遗忘会导致 ResourceBlocked 报错。建议
  `docs-site/dev/security.md` 加 checklist。
- HSTS `max-age=31536000` 在 mistake config 时锁死浏览器 1 年——上线
  前应当先用 `max-age=300` 灰度 24h，确认 https 稳定后再切换长 TTL。
  本 ADR 默认值适合稳定 production；初次切换的运维 SOP 留给 deploy.md。

## Follow-ups

1. CSP nonce-based migration：剔除 `'unsafe-inline'` 的 script/style，
   配合 vite plugin 注入 build-time nonce。预计 v0.10.x 与
   ProjectSettingsPage 重构同窗口做。
2. `Permissions-Policy` 头补全（camera / microphone 等）。
3. CORS preflight 路径是否需要单独 short-circuit 跳过 SecurityHeaders？
   当前不跳过——浏览器看 OPTIONS 响应也希望带 HSTS。
