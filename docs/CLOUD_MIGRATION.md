# Supabase 云端迁移：操作与验收

当前仓库有五条迁移，已经通过本地数据库验证。仅迁移结构、RLS、RPC、桶定义及 Realtime；
本地用户账号、业务记录和 Storage 照片文件不会自动搬到云端。

## 开始前确认

已由用户确认并通过 CLI 项目列表核实的目标：

```text
Project ID: xhvkbjtcylpgpccgkoaw
Project URL: https://xhvkbjtcylpgpccgkoaw.supabase.co
```

最初 URL 中的 `xhxvbjtcylpgpccgkoaw` 是错误编号，该编号链接返回 Not Found。
目标项目的控制台 Project ID、Project URL 主机名前缀及 legacy anon JWT 的 `ref` 必须一致。
不要编辑 JWT 内容来“修正”项目编号，也不要带上粘贴时多出的中文括号。

anon/publishable key 用于前端访问，不是 CLI 的管理访问令牌或数据库密码。
CLI 已登录并链接上述正确项目，五条迁移已成功推送，下面保留复现及验收步骤。

## 1. 登录及链接

在项目根目录 PowerShell 执行：

```powershell
npx supabase login
npx supabase link --project-ref xhvkbjtcylpgpccgkoaw
```

登录按终端提示完成浏览器流程；如要求管理访问令牌，在本地终端输入。
如 link 要求数据库密码，输入创建该项目时的 Database Password。
不要把这两种私有凭据写入 Git、命令历史中的参数或聊天。

成功后应显示 `Finished supabase link.`。链接元数据位于被 Git 忽略的 `supabase/.temp/`。

## 2. 检查并推送

```powershell
npx supabase db push --linked --dry-run --skip-vault
npx supabase db push --linked --skip-vault
npx supabase migration list --linked
```

`--skip-vault` 是当前项目安装的 CLI 2.122.0 提供的参数，限定本次操作为 SQL 迁移，
不顺带同步本地 Vault 配置。先确认 dry-run 的目标项目和以下五个版本，再执行 push：

```text
20261026000000_baseline.sql
20261027162443_align_schema.sql
20261029132447_pairing_rpc.sql
20261030144521_whispers_realtime.sql
20261030162043_dashboard_wishes_view.sql
```

只使用 `supabase/migrations/`，归档目录 `supabase/legacy-migrations/` 不参与推送。
应用成功后 migration list 的 Local / Remote 两列应包含相同的五个版本。
若有 SQL 错误，保留完整错误与失败文件名，先解决错误再继续，不伪造迁移历史。

## 3. 云端验收

打开目标项目 SQL Editor，运行 `supabase/tests/cloud-security.sql` 全部内容。
该文件只查询及断言，检查五条迁移记录、public 表 RLS、策略角色及 UPDATE 校验、
配对 RPC、私有桶的三条成员策略、Realtime 以及 wishes 视图隔离。
仅出现成功通知且没有 SQL 错误，才能确认云端数据库阶段通过。
该验收文件已经在本地数据库试运行通过；本地通过不代表云端已完成迁移，仍需在目标云项目执行。
本次已通过 `supabase db query --linked --file supabase/tests/cloud-security.sql` 在上述云项目实际执行验收。

## 4. 邮箱注册

在目标云项目的 Authentication → Sign In / Providers（部分界面显示 Providers）→ Email，
保持 Email provider 启用，关闭 Confirm email 并保存。之后新注册用户无需点邮件确认。
这属于云端 Auth 设置，不会通过 `db push` 从本地 `config.toml` 自动同步。

## 5. couple-media 桶

`20261027162443_align_schema.sql` 已包含创建 `couple-media` 并将 `public` 设为 false 的 SQL，
同时创建按情侣编号隔离的 SELECT / INSERT / DELETE Storage 策略。
正常完整推送后应自动存在私有桶，无需重复手建。

验收 SQL 的预期结果：

```text
id            public
couple-media  false
```

如果没有该桶，先检查迁移是否完整执行。确实需要手建时，在云端 Storage → New bucket，
名称填写 `couple-media`，关闭 Public bucket，创建后再核对三条成员策略，不能只建桶而漏掉 RLS。
已有本地照片文件不会随桶定义上传，需要另行处理文件及对应业务记录。

官方参考：
[迁移部署](https://supabase.com/docs/guides/deployment/database-migrations)、
[CLI 登录与链接](https://supabase.com/docs/reference/cli/supabase-link)、
[创建 Storage 桶](https://supabase.com/docs/guides/storage/buckets/creating-buckets)。

## 本次云端执行结果

- 已链接 `xhvkbjtcylpgpccgkoaw`；用户提供的 anon Key 经云端公开 Auth 接口验证可用。
- `db push --linked --skip-vault --yes` 已成功应用五条迁移，Local / Remote 版本一致。
- 30 个 public 表全部启用 RLS，策略角色与 UPDATE 校验通过。
- 3 个成员/配对 SECURITY DEFINER 函数、私有 `couple-media` 桶及三条成员 Storage 策略通过。
- `whispers` 的 Realtime INSERT / UPDATE 及 `wishes` 的 security_invoker 隔离通过。
- 用户关闭并保存后，已用云端公开 Auth settings 接口复核：Email provider 和注册已启用，Confirm email 已关闭。
- 本次未搬迁本地账号、业务记录或照片文件；未修改本地开发连接目标。
