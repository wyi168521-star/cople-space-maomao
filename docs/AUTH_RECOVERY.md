# 登录会话恢复与网络转发

云端网页的 Auth 和 REST 请求通过同源 `/api/supabase/` 交给 Nitro，再访问配置的 Supabase 项目。
浏览器不必直接连接 Supabase 域名才能登录、注册、刷新 Token 或读取空间信息。
本地 HTTP Supabase、原生 Capacitor、Storage 上传和 Realtime WebSocket 继续使用原通道。
SDK 的项目 URL、会话 storage key 和已有登录数据不变，无需新增环境变量。

转发仅允许固定项目的 Auth / REST 路径，不允许 admin、任意目标或重定向。
使用已有 publishable key 和当前用户 JWT，仍由 Supabase 验证身份与执行 RLS。
请求体、密码、Token 不写入应用日志；会话及查询响应禁止缓存。
每次上游请求最多 10 秒，网页转发请求最多 12 秒；断开连接会取消上游请求。

会话恢复最多等待 45 秒，覆盖 SDK 的刷新重试；空间信息查询仍最多 8 秒。
超时后显示重试与本机会话清理入口。同一有效监听收到晚到的登录或 Token 刷新事件时可自动恢复；
主动重试、退出或销毁仍阻止旧订阅覆盖新状态。

“清除本机登录状态并重新登录”仅在用户点击时移除当前项目的认证、用户缓存及 PKCE key，
随后刷新当前 URL，保留邀请参数。不会删除云端账户、成员关系、照片、回忆或其他项目的浏览器数据。

## 验证

### Cloudflare Pages 部署

运行 42984761510（cb2abfb）在 Wrangler 部署步骤失败：非交互环境缺少
`CLOUDFLARE_API_TOKEN`。同一次运行中的 Cloudflare account ID 和 Supabase 配置也为空。
Node.js 弃用警告不是该次失败的原因。

在 GitHub 仓库 Settings → Secrets and variables → Actions 中配置以下 repository secrets：

- `CLOUDFLARE_API_TOKEN`：对目标账户具有 Cloudflare Pages Edit 权限的 API token。
- `CLOUDFLARE_ACCOUNT_ID`：已有 `love-home` Pages 项目所在账户的 ID。
- `NUXT_PUBLIC_SUPABASE_URL`：云端 Supabase 项目 HTTPS URL。
- `NUXT_PUBLIC_SUPABASE_ANON_KEY`：同一项目的 anon / publishable key，不能使用 service-role key。

这些值须可供部署 job 读取；仅设置在 Cloudflare 控制台或 GitHub variables 中不会提供
工作流所引用的 GitHub secrets。预检只输出缺失项名称，不输出值。

部署使用 `npm run build:cloudflare`，保留 Nitro `/api/supabase/**` 服务端路由，
将 `dist`（包含 `_worker.js/index.js` 和 `_routes.json`）交给 Wrangler。
`npm run generate` 仍用于静态/移动端构建，但它不能部署这个服务端登录转发。
`wrangler.toml` 固定输出目录、兼容日期和 `nodejs_compat`，供构建与部署共同使用。
Supabase 公开配置在 Actions 构建时注入；若 Pages 配置了同名运行时变量，需与构建值一致。

合并修复并配置 secrets 后，在 Actions 中对最新 main 运行
“Deploy Love Home to Cloudflare Pages”（不要重跑旧提交的失败 run）。
确认预检、构建、产物检查和部署全部成功，再打开 https://love-home.pages.dev/login：

- Network 中 Auth/REST 应访问同源 `/api/supabase/`，响应应为 API JSON，不能是静态 HTML 或 404。
- 使用自己的账户登录，确认 token 请求成功并能读取空间信息；刷新页面确认会话恢复。
- 可先 GET `/api/supabase/auth/v1/settings` 检查服务连通性；503 表示缺少运行时配置，502/504 表示上游连接失败。

本地可用 `npm run build:cloudflare` 和 `npx wrangler pages dev dist` 检查 Worker；
需要使用测试项目配置。不要将真实密码或 token 粘贴到日志、工单或测试夹具中。

- `tests/authRecoverySdk.test.ts` 使用真实 Supabase SDK 恢复过期的测试会话，模拟超过 8 秒的刷新和一次网络重试。
- `tests/authSession.test.ts` 检查总截止时间、晚到事件恢复、陈旧回调隔离与邀请路由。
- `tests/supabaseRelay.test.ts` 检查请求、状态码、count 头、权限转发、超时、断连和路径限制。
- `tests/supabaseClient.test.ts` 检查 URL 改写、原 Request 保留、取消和仅清除当前项目的会话。

手工测试时可在 Network 查看 `/api/supabase/auth/v1/token` 与 `/api/supabase/rest/v1/couple_members`。
不要分享请求体、Authorization 或完整 token 响应；记录状态码与脱敏错误即可。
