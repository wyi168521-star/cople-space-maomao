# 公网部署前检查：第一部分

本阶段只整理代码、环境配置与 Git 忽略规则，未推送 GitHub、连接云端数据库或发布站点。

## 配置隔离

- 应用代码和 `nuxt.config.ts` 中没有固定的开发机地址。
- 浏览器 Supabase 客户端及 AI 后端的认证校验都读取
  `NUXT_PUBLIC_SUPABASE_URL`、`NUXT_PUBLIC_SUPABASE_ANON_KEY`。
  客户端统一在 `app/lib/supabase.ts` 初始化。
- `.env.example` 与 `.env.production.example` 仅含云端 HTTPS 占位地址及空凭据。
- 本机 `.env.local` 保留本地 Docker 地址和已有 Key，方便继续本地预览。
  此文件已被 Git 忽略且未被跟踪，不会进入 GitHub，也不会被默认的生产构建读取。
  `npm run dev` 通过专用 `--dotenv .env.local` 参数读取它。
- 生产部署使用托管平台的环境变量，不复制 `.env.local`。

DeepSeek Key 不作为 Nuxt 构建默认值保存。`NUXT_DEEPSEEK_API_KEY` 通过私有运行时
配置注入；已有的 `DEEPSEEK_API_KEY` 别名由服务端请求时读取。二者都不能使用
`PUBLIC` 前缀。模型默认 `deepseek-flash`。

移除了未使用的公开 `zegoAppSign` 字段和原作者 AppID 默认值。
可选通话服务必须使用自己的公开 AppID，私有 ZEGO 凭据保存在服务端。

## 本地配置与部署代码

`supabase/config.toml` 是本地 CLI 配置：已清除过期的开发机网卡地址，API/Studio
沿用 CLI 默认值，Auth 使用本地默认回跳地址。它不会随 SQL 迁移自动变成云端配置。
文档、测试和本地 CLI 中的回环地址是本地开发用途，不是线上应用的连接目标。
本次没有重启数据库或改动迁移历史；正在运行的本地数据库保留原状态。

Windows 的 `scripts/serve.ps1` 改为使用宿主环境，尊重外部 `PORT` / `HOST`，
不再静默加载本地 `.env` 或固定绑定回环网卡。

## Git 与提交前复核

`.env`、`.env.local`、其他真实环境文件、`node_modules`、`.nuxt`、`.output`、
`.vercel`、测试缓存及隔离构建产物均被忽略。两份环境模板可正常提交。
扫描已跟踪与新增候选文件时，检查已配置私有密钥及常见明文凭据，只报告文件名。

提交前执行：

```bash
npm run check:deploy
```

检查范围为当前待提交内容及应用运行代码，不等同于对全部 Git 历史或所有形式的密钥
进行专业审计。本次本地真实环境文件未被跟踪，也未发现已配置 Key 混入候选文件。

## 构建方式

当前项目包含 `server/api/ai/*`，生产应使用 `npm run build` 的 Nitro 服务端构建。
纯静态 `npm run generate` 不会提供这些 AI 后端接口。

部署变量模板见 `.env.production.example`。本检查阶段只准备代码与配置模板。
后续真实云项目及迁移验收结果见 [云端迁移记录](CLOUD_MIGRATION.md)；Vercel 配置独立处理。

## 本次验证

- 提交前检查通过：138 个应用文件没有固定的本机 URL；候选文件未发现已配置的私有密钥。
- 前后端 TypeScript 检查与 89 项单元测试通过。
- 在隔离目录完成生产构建，修复了共享 AI 工具在 SSR 打包时的路径解析问题，
  应用与服务端统一使用 Nuxt 的 `#shared` 别名。
- 64 个公开构建文件未包含私有测试配置值。
- 构建后的生产服务实际启动成功，登录页返回 200，运行时公共环境变量可覆盖构建占位值；
  页面未包含私有配置，已打包的 AI 接口拒绝匿名请求并返回 401。
- 构建验收仅使用测试占位变量，未使用真实云端数据库或调用付费模型。
- 本地 5 条迁移的记录仍与文件一致，开发服务继续运行。
