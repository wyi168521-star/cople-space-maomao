# Nuxt 基础结构与本地 Supabase 验证

基于上游 `XTH-LOVE/Love` 的 `4f7a9922d97652b54d2b5b632b6f457600d21eca`，保留 Nuxt 4 / Vue 3 与原业务组件。本文区分本轮实际执行结果与此前界面验证记录。

## 当前本地数据库进度

| 项目 | 当前结果 |
| --- | --- |
| Docker 命令访问 | 已修复执行进程 PATH；`docker --version` 返回 29.9.2，`docker ps` 成功。 |
| 迁移依赖 | 原失败缺少 `messages` 建表前置步骤；已按真实依赖整理。 |
| 原始迁移 | 23 份文件归档于 `supabase/legacy-migrations/`，来源哈希保存在 `baseline-sources.json`。 |
| 本地 SQL 初始化 | `supabase start` 退出码 0，baseline 与 align_schema 均应用成功；数据库、认证、Storage 等核心服务健康。 |
| 待执行迁移 | `supabase migration up` 退出码 0，`applied=[]`，没有待执行迁移。 |
| 安全策略验收 SQL | 真实本地 PostgreSQL 的四项断言全部通过，详情见下表。 |
| 实际数据库生成类型 | `npm run db:gen-types` 从本地数据库生成 `app/types/database.generated.ts`，当前 1015 行，包含两个配对 RPC；唯一工厂已接入 `createClient<Database>` 和 `SupabaseClient<Database>`。 |
| 本地环境变量 | 已从本地 status 写入 URL 与 anon key；确认密钥角色为 anon，`.env.local` 被 Git 忽略。 |
| TypeScript 编译 | `npx tsc --noEmit` 及 app、server、shared、node 四个实际项目检查全部退出 0。 |
| 前端单元测试 | 最新 Vitest 全量执行，6 个文件、29 项测试全部通过，包含会话竞争、查询失败和配对后的状态刷新。 |

未关联或修改云端数据库。Supabase CLI 仍固定为 `2.122.0`；Docker 可访问后，CLI 已能拉取镜像并执行 SQL，无需因原 PATH 问题降级。本地 API 为 `http://127.0.0.1:54321`，Studio 为 `http://127.0.0.1:54323`，数据库端口为 `54322`。

真实 PostgreSQL 安全验收结果：

| 查询 | 实际结果 |
| --- | --- |
| public 表 RLS | 30 张表，全部 `rowsecurity=true`。 |
| public 策略 | 74 项策略，全部 `roles={authenticated}`；所有 UPDATE/ALL 的 `with_check` 非空。 |
| `user_couple_ids` | 函数存在，`prosecdef=true`。 |
| `couple-media` | bucket 存在，`public=false`。 |

## 连贯的迁移结构

`supabase/migrations/` 按顺序包含以下活动 SQL：

1. `20261026000000_baseline.sql`：按依赖合入 33 个来源，包括原 23 份迁移及 10 份补充安装脚本。先创建 messages、couple_letters、媒体配置和资料 RPC，再执行依赖它们的历史升级。旧来源的事务外壳在生成时去除，整份基础迁移使用单一显式 BEGIN/COMMIT，使 LOCK TABLE 与结构升级处于事务中。
2. `20261027162443_align_schema.sql`：补列、建表、约束、索引、辅助函数、RLS、显式授权与 Storage 收尾，然后执行只读数据自检。
3. `20261029132447_pairing_rpc.sql`：在显式事务内创建配对 RPC，并限制为 authenticated 执行。

`node supabase/scripts/rebuild-baseline.mjs` 可按记录的来源顺序重新生成基础迁移；归档中的原 SQL 保持完整。`messages` 并未废弃：前端仍读取它，并与 `whispers` 按原 ID 双向同步。相册旧表和归属保护等兼容逻辑也继续保留。

合并历史只用于全新本地初始化；已有部署继续保留自己的迁移历史，不直接向既有云端数据库推送这份基础迁移。

## 权限与 Storage 收尾

- 所有应用 public 表启用 RLS；已有 public 策略角色统一为 authenticated，UPDATE/ALL 补齐明确的 WITH CHECK。
- 表访问授权按实际策略命令授予，account_usernames 保持无客户端直接访问权限。whispers 使用 read_at 列级 UPDATE，其他消息字段不可更新。
- user_couple_ids() 使用 SECURITY DEFINER 与空 search_path，撤销匿名和 PUBLIC 的执行入口，仅向需要的 API 角色授权。
- daily_answers 的读取、更新与计数函数增加所属情侣检查，避免跨空间读取或迁移回答。
- 保留 memory-photos、album-media、message-media 和 avatars，增加私有 couple-media 及路径策略。已有媒体路径和上传代码不需要重命名。
- 原有新旧字段和媒体双向同步、作者保护、纪念日默认值兼容均保留。此次不宣称完整注销移交流程、真实媒体上传或 Realtime 投递已经验证。

验收查询与本地重建命令见 README 的“初始化本地 Supabase”。本轮通过真实 Docker PostgreSQL 执行查询与断言，结果如上表；这组检查验证结构与授权元数据，不等同于所有应用业务链路的端到端验收。

## Nuxt 类型与环境接入

`app/types/database.generated.ts` 已由 CLI 从真实本地数据库导出完整 Database schema，生成内容没有手工修改；`app/types/database.ts` 保留已有兼容行类型。唯一 SDK 初始化入口 `app/lib/supabase.ts` 已接入 Database 泛型，查询 composable 复用同一客户端类型；Nuxt 插件继续逐应用实例注入，避免 SSR 共用会话。

接入后修复了已有 SDK 受保护成员访问、上传队列变量、空值收窄与 PromiseLike 类型问题。写入前显式检查情侣空间，新增载荷填写新旧字段的同值映射；RPC JSON 先校验为对象或数组。仅针对 SQL 允许 NULL、但生成器未表达可空参数的 `record_couple_activity_context`，使用单独的精确调用签名，其余查询保留原始生成类型约束。

`.env.local` 使用 `NUXT_PUBLIC_SUPABASE_URL` 和 `NUXT_PUBLIC_SUPABASE_ANON_KEY`。启动与静态生成需显式传入 `--dotenv .env.local`；该文件被 Git 忽略，报告不包含实际密钥。

```bash
npm run db:gen-types
npx nuxt prepare
npx tsc --noEmit
npx tsc --noEmit --project .nuxt/tsconfig.app.json
npx tsc --noEmit --project .nuxt/tsconfig.server.json
npx tsc --noEmit --project .nuxt/tsconfig.shared.json
npx tsc --noEmit --project .nuxt/tsconfig.node.json
```

根 tsconfig 采用 project references，单独运行根命令不构成完整 Nuxt 应用类型检查。本轮同时检查上述四个实际 TypeScript 项目，全部退出 0；这组 tsc 检查不包含独立的 Vue SFC vue-tsc 检查。

## 认证与配对阶段：第一部分

框架仍为 Nuxt 4 / Vue 3。本节记录先前后端配对接口的完成情况；前端认证、守卫和人工验收入口已在后续阶段接入，见下一节。

- 已通过 CLI 创建 `20261029132447_pairing_rpc.sql`，本地 `migration up` 成功应用。
- `create_couple(text,text,date)` 返回新空间 UUID，并创建当前用户 role=a 的成员关系；`join_couple(uuid)` 返回目标 UUID，并创建 role=b。
- 两个函数均为 SECURITY DEFINER、空 search_path，仅向 authenticated 授予 EXECUTE；无会话、无资料、重复配对、空参数和满空间均拒绝。
- 使用资料行 FOR NO KEY UPDATE 串行同一用户的新请求，加入时锁定空间父行；原唯一约束保留。没有新增成员表直接写入策略或权限。
- `npm run db:gen-types` 成功，类型更新为 1015 行；应用实际 TypeScript 项目再次检查退出 0。
- `supabase/tests/pairing-rpc.sql` 已在真实本地 PostgreSQL 中通过，覆盖权限、校验、a/b 角色、成员 RLS、失败无孤立记录、a 离开后 b 已占用的拒绝行为，以及旧邀请码 RPC 的兼容性。测试以 ROLLBACK 结束，不保留测试用户或业务行；没有把单连接测试称作并发压力测试。

## 回归与既有界面验证

### 当前认证与配对前端

`npm install` 成功，Nuxt prepare 成功；`npm run dev` 启动于 `http://127.0.0.1:3200/`，已验证 `/login` HTTP 200。当前执行环境刷新系统和用户 PATH 后使用宿主机 Node 26.13.0 与 npm 11.20.0。npm 另报告 36 项依赖审计问题（4 low、6 moderate、20 high、6 critical），没有阻止安装和启动；本轮没有自动升级整套依赖。

- 启用 Nuxt 文件路由，入口为 ClientOnly/NuxtPage；原完整业务页面保存在 `app/legacy-app.vue`。
- `/login` 提供邮箱注册/登录和邮件确认提示；`/pairing` 创建或按 UUID 加入；`/` 显示空间 ID 和退出按钮。
- 会话使用每个 Nuxt 应用独立的 useState 和单一 Auth 订阅；Auth 回调在下一任务读取成员关系，避免 SDK 锁重入。查询失败显示重试状态，旧请求不能覆盖退出或切换账户后的状态。
- `npx tsc --noEmit` 与实际应用 TypeScript 检查通过；6 个测试文件、29 项单元测试通过。
- 真实 Chrome 的 12 项浏览器检查通过：A/B 真实注册、本地 Mailpit 邮件确认、创建/加入相同 UUID、无效 UUID 提示、刷新会话、已配对路由分发、退出保护及隔离会话不受影响；375px 无横向溢出，两套会话无运行时异常。自动化的临时 Auth 用户与自建空间已清理。

逐步人工验收和 F12 排查见 `docs/MANUAL_AUTH_TEST.md`。本地服务器保留运行供人工测试；没有将这些结果称作生产环境验收。

数据库兼容回归使用 `supabase/tests/` 的 PGlite 0.5.12 与 pgcrypto，历史 SQL 的测试来源已切换到归档路径。最新 366 项检查通过，覆盖字段映射、原数据、角色约束、新旧接口同步、RLS 与 Storage 元数据权限。独立测试使用最小 Auth/Storage SQL 桩，与本次真实 Supabase 的服务健康和安全验收分开记录。

```bash
npm ci --prefix supabase/tests
npm test --prefix supabase/tests
```

本轮重新执行全部 Vitest：5 个文件、19 项测试通过。此前基础层还验证了 nuxt prepare、nuxt generate，以及 1280px、375px、320px 的演示模式浏览器检查：导航、页面切换和编辑器正常，无横向溢出或运行时异常；这些界面检查不是本轮重新执行的结果。

Tailwind v4 使用完整入口与既有主题映射；Manrope / Nunito Sans 字体从已安装包本地加载。`app/pages` 已启用登录、配对及首页文件路由。

后续线上验收仍需覆盖真实认证、文件上传及大小/MIME 校验、签名 URL、Realtime 和外部通话服务；本次本地初始化不包含云端部署或生产数据操作。

本地日志采集仍有一项限制：Vector 容器访问 Windows 默认 Docker TCP 日志入口 `2375` 被拒绝，容器会重启。数据库、API、认证、Storage 与本轮 SQL 验收正常；本轮没有修改宿主机的 Docker 引擎监听设置。
