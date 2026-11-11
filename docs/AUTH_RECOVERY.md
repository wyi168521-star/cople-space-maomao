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

- `tests/authRecoverySdk.test.ts` 使用真实 Supabase SDK 恢复过期的测试会话，模拟超过 8 秒的刷新和一次网络重试。
- `tests/authSession.test.ts` 检查总截止时间、晚到事件恢复、陈旧回调隔离与邀请路由。
- `tests/supabaseRelay.test.ts` 检查请求、状态码、count 头、权限转发、超时、断连和路径限制。
- `tests/supabaseClient.test.ts` 检查 URL 改写、原 Request 保留、取消和仅清除当前项目的会话。

手工测试时可在 Network 查看 `/api/supabase/auth/v1/token` 与 `/api/supabase/rest/v1/couple_members`。
不要分享请求体、Authorization 或完整 token 响应；记录状态码与脱敏错误即可。
