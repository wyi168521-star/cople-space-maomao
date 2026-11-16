# 登录会话持久化修复与验收

本次目标站点是 `https://cople-space-maomao.vercel.app`。本地修复与测试不代表生产版本已经更新。

## 查到的问题与证据

1. `useCoupleAuth.signOut()` 原先没有传 scope。Supabase 默认使用 global，会撤销同一账号在其他设备上的会话；改为 `scope: 'local'`。
2. 原先退出前就取消认证监听。SDK 已清除本地会话、但服务器注销请求失败时，页面仍可能显示旧用户；现在保留监听，以 SDK 的 SIGNED_OUT 事件同步界面。
3. SDK 默认在本地存储不可用时可能退回内存，导致登录不能跨浏览器进程保留。现在显式使用 SDK 支持的 localStorage 适配器，并在恢复前检测读写能力；失败时展示可重试的错误，不假装已经持久保存。
4. 用真实 SDK 复现：刷新过期令牌时收到 HTML 404，会被当成不可恢复的认证错误并删除会话。现在只把刷新接口的 HTML 页面转换为可重试的服务错误，保留 SDK 的刷新机制。真实的 Supabase JSON 撤销令牌错误不被屏蔽，仍要求重新登录。

会话存储键、令牌有效期、配对查询和 RLS 均未更改。没有增加密码存储、Cookie 复制或另一套令牌刷新逻辑。

参考：[Supabase signOut](https://supabase.com/docs/reference/javascript/auth-signout)、[会话生命周期](https://supabase.com/docs/guides/auth/sessions)。

## 已验证与限制

- 159 项单元及 SDK 回归测试通过，包括临时断网保留会话、HTML 网关错误保留会话、真实令牌撤销要求重新登录。
- `tsc --noEmit` 及 Nuxt app、server、node 项目的 TypeScript 检查通过。
- Node 和 Vercel 正式构建均通过；本地验收构建使用虚构公开配置，不能直接拿来发布生产。
- 正式构建上的 10 项 Playwright 测试通过：桌面和移动端模拟各 5 项，覆盖刷新、关标签页、关闭并重启浏览器进程、本设备退出、另一设备令牌刷新、未配对分流、存储不可用提示、远端注销失败后的本地退出。
- 浏览器与 Supabase SDK 是真实实现；账号、JWT、数据库和认证接口响应是隔离的测试夹具。没有创建或修改云端账号，没有输出真实令牌，没有调用付费 AI。
- 移动端测试是 Chromium 的设备模拟，不等于真机 Android/iOS 或 Capacitor 验收。没有实际重启 Windows，也没有用真实账号验证线上会话。
- 开发模式的 Vue 调试工具会在本地存储被完全禁用时先行报错，因此完整存储禁用测试使用正式构建，不以开发工具故障冒充业务认证测试结果。

## 重跑浏览器验收

使用隔离测试项目配置构建并启动正式服务器后，例如服务器监听 `http://127.0.0.1:3321`，在 PowerShell 执行：

```powershell
$env:PLAYWRIGHT_BASE_URL = 'http://127.0.0.1:3321'
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run test:e2e -- tests/e2e/auth-persistence.spec.ts --workers=1
```

`PLAYWRIGHT_BASE_URL` 表示使用已经运行的测试服务器；未设置时保留原有 3200 端口开发服务器逻辑。测试的浏览器配置目录仅用于虚构会话，与用户日常浏览器资料隔离。

## 发布后人工验收

1. 使用普通浏览器模式，在固定的 Vercel 域名登录自己的账号。不要提供密码或令牌给测试人员。
2. 刷新、关闭标签页再打开，确认已配对账号回首页、未配对账号回配对页。
3. 完全退出浏览器后再打开，随后重启自己的设备再访问，验证会话恢复。
4. 在另一台自有设备独立登录同一测试账号；第一台主动退出后，确认第二台仍能使用和刷新会话。
5. 主动退出后重新打开网站，确认仍需登录。短暂断网时先恢复网络并点击“重新检查登录状态”，不要立刻清除本机登录信息。
6. 如仍复现，检查浏览器是否使用无痕模式、退出时清除站点数据，或被隐私插件限制存储；检查 Supabase 是否启用了单会话、会话最长时限或不活跃超时。不要为修复掉登录关闭令牌过期机制。
7. 记录受影响域名、浏览器、发生时间、刷新接口的状态码和脱敏错误。不要分享 Authorization、请求体或完整会话响应。

localhost、局域网 IP、Vercel 正式域名和预览域名的存储相互隔离；不同 Supabase 项目也是不同认证系统，不能复制令牌来“统一登录”。部署必须使用目标 Vercel 项目自己的环境变量，不能发布本地验收使用的虚构配置。
