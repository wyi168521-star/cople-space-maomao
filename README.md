<p align="center">
  <img src="public/couplespace-mark.svg" width="108" alt="Love小家 logo">
</p>

<h1 align="center">Love小家 · CoupleSpace</h1>

<p align="center">
  一个真正属于两个人的私密生活空间。<br>
  把照片、视频、悄悄话、纪念日、AI 灵感和共同宠物，认真收藏在一起。
</p>

<p align="center">
  <a href="https://github.com/XTH-LOVE/Love-"><img src="https://img.shields.io/github/stars/XTH-LOVE/Love-?style=for-the-badge&color=ff6fae&label=Stars" alt="GitHub stars"></a>
  <a href="https://github.com/XTH-LOVE/Love-/network/members"><img src="https://img.shields.io/github/forks/XTH-LOVE/Love-?style=for-the-badge&color=9c6ade&label=Forks" alt="GitHub forks"></a>
  <a href="https://github.com/XTH-LOVE/Love-/blob/HEAD/LICENSE"><img src="https://img.shields.io/github/license/XTH-LOVE/Love-?style=for-the-badge&color=7eb8e8" alt="MIT license"></a>
  <a href="https://love-home.pages.dev/"><img src="https://img.shields.io/badge/Live%20Demo-love--home.pages.dev-f4a1c5?style=for-the-badge" alt="Live demo"></a>
</p>

<p align="center">
  <a href="#为什么做-love小家">为什么做</a> ·
  <a href="#功能一览">功能一览</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#构建与发布">部署</a> ·
  <a href="#参与贡献">参与贡献</a>
</p>

<p align="center">
  <img src="public/login-couple.jpg" width="820" alt="Love小家登录页预览">
</p>

## 为什么做 Love小家

很多情侣应用只提供一个聊天框，或者把纪念日、相册和日记拆散在不同产品里。Love小家想做的是一个更完整、更有温度的双人空间：

- 不是公开社交网络，而是只属于同一情侣空间成员的私密房间。
- 不是一次性发完就消失的聊天，而是可以回看的共同记忆库。
- 不是冷冰冰的工具集合，而是有开屏、品牌、情绪化视觉和共同宠物的长期陪伴产品。
- 不是只停留在网页的 Demo，而是同时面向 Web、Android 和 Windows 桌面端设计。

Love小家使用淡紫、淡粉、白色和玻璃质感作为视觉基调，把“记录日常”做成一种轻松、浪漫、愿意每天打开的习惯。

## English overview

**Love小家 (CoupleSpace)** is a private, realtime space for two people. It combines shared memories, albums, private messages, anniversaries, AI-assisted writing, location sharing, realtime calls and a growing virtual pet system in one calm, romantic interface.

It is built with Nuxt 4, Vue 3, TypeScript and Supabase, and can be shipped as a static web app, an Android application through Capacitor, or a Windows desktop app through Electron. The repository is intentionally self-hostable: authentication, database policies, storage, realtime channels and server-side secrets are documented so developers can build their own private couple space instead of relying on a public social network.

The project is still evolving. Contributions are welcome, especially around accessibility, offline media, better pet interactions, testing and platform polish.

## 功能一览

### 首页：你们的共同入口

- 实时显示在一起的天、时、分、秒。
- 支持选择共同封面，并根据照片比例自动适配展示区域。
- 最近共同回忆最多展示 10 项，支持照片和视频预览。
- 今日情话轮播、共同计划、下一个纪念日和情书入口集中在首页。
- 首页展示悄悄话未读角标和系统通知入口。
- 支持开屏动画、一次性软件声明、版本更新提示和关于软件页面。

### 时光轴：把故事写下来

- 按日期记录文字、地点、照片和视频。
- 支持编辑、删除和回看已经保存的共同回忆。
- 每条内容显示记录日期、地点和上传成员。
- 适合记录第一次旅行、生日、见面、纪念日和普通但值得记住的一天。

### 相册：照片和视频分开管理

- 创建多个相册，按相册、照片、视频和时光轴来源筛选。
- 支持一次选择多张照片或多个视频上传。
- 图片上传前进行客户端压缩，减少手机端等待时间。
- 图片和视频支持预览、全屏查看、下载和删除。
- 每项媒体显示拍摄日期和添加者。
- 使用签名地址、浏览器缓存和分批加载，避免每次打开都重新等待全部媒体。

### 悄悄话：双人实时消息

- 文字消息、照片、短视频、语音和表情表达。
- 消息按时间展示，并显示发送状态、已读状态和发送者头像。
- 打开聊天后自动标记已读，自动滚动到最新消息。
- Enter 快速发送，手机端使用全屏聊天布局。
- 支持撤回自己发送的消息和媒体。
- 支持发送当前位置、共享实时位置、真实地图查看、放大缩小和全屏地图。
- 支持语音通话、视频通话以及无需接听即可收听的开麦模式。
- 支持系统级通知、来电提示和网络重连。

> 通话、系统通知、实时位置和地图需要浏览器/系统权限以及对应的 Supabase、ZEGO 或地图服务配置。未配置外部服务时，核心页面仍可启动并用于本地演示。

### 纪念日：重要日子不再错过

- 设置在一起的日期，并实时计算共同经历的时间。
- 创建可重复的纪念日、旅行日、生日和自定义日期。
- 显示下一个即将到来的特别日子和剩余天数。

### 清单：一起完成的小事

- 创建共同计划、备注、分类、优先级和计划日期。
- 任意一方完成后，另一方可以实时看到状态变化。
- 首页显示待完成事项和完成进度。

### 心动 AI：让 AI 帮你写得更像你们

- AI 约会策划：根据城市、预算和偏好生成约会方案。
- AI 日记：根据当天真实素材生成可保存的共同日记。
- AI 情书：选择收件人、字数和语气，生成后保存为长期作品。
- 生成结果可以展开全文，切换页面后仍可从历史记录中打开。
- 使用 Supabase Edge Function 代理小米 MiMo 请求，API Key 不放进前端。
- 服务端包含请求长度限制、频率限制和错误提示，避免把 AI 生成变成不可控的黑盒。

### 宠物小屋：一起养一只属于你们的宠物

- 支持不同宠物种类、皮肤、配饰和 3D Fox 模型。
- 宠物拥有喂养、互动、成长和进化机制。
- 共同互动可以积累续火花天数。
- 支持宠物小屋、家具扩展和专属动作的持续开发。

## 视觉与交互

- 桌面端：浮动玻璃侧边栏，适合宽屏持续使用。
- 手机端：浮动底部导航，避开状态栏和系统导航区域。
- 大圆角、半透明表面、淡紫淡粉渐变和柔和阴影。
- 使用 Manrope 与 Nunito Sans，兼顾英文产品信息和中文界面阅读。
- 使用 Lucide 图标，按钮保留清晰的图标、状态和无障碍标签。
- 上传、加载、失败重试、空状态和移动端安全区均有独立处理。

## 技术栈

| 层级 | 技术 | 用途 |
| --- | --- | --- |
| Web 应用 | Nuxt 4、Vue 3、TypeScript | SSR、静态生成和组件化界面 |
| 样式与交互 | Tailwind CSS v4、CSS、玻璃质感设计、Lucide | 主题变量、工具类、响应式布局和图标系统 |
| 用户与数据 | Supabase Auth、Postgres、RLS | 登录、情侣空间、数据隔离和权限控制 |
| 实时能力 | Supabase Realtime | 消息、情书、宠物和共同数据同步 |
| 私密媒体 | Supabase Storage | 照片、视频、语音和短期签名地址 |
| 服务端能力 | Supabase Edge Functions | AI 请求代理、ZEGO Token、敏感逻辑隔离 |
| AI | 小米 MiMo | 约会策划、共同日记和情书生成 |
| 通话 | ZEGO Express | 音频通话、视频通话和开麦模式 |
| 地图 | Leaflet / 高德地图配置 | 位置消息、实时位置和地图展示 |
| 3D | Three.js、GLB 模型 | 宠物模型、动作和进化展示 |
| 移动端 | Capacitor Android | Android APK 构建和系统能力接入 |
| 桌面端 | Electron | Windows 桌面软件和自动加载线上版本 |

## 项目结构

```text
CoupleSpace/
├─ app/
│  ├─ app.vue                 # 应用入口，保留现有业务视图和导航状态
│  ├─ components/
│  │  ├─ ui/                 # GlassCard、PageTransition、EmptyState、Loading
│  │  ├─ layout/             # AppShell、SideNav（桌面）、BottomNav（手机）
│  │  └─ *.vue               # 现有首页、相册、时光、聊天、AI、宠物等业务组件
│  ├─ composables/           # useAuth、useSupabaseQuery、useRealtime 及已有业务逻辑
│  ├─ lib/supabase.ts        # 唯一 createClient 入口，按 Nuxt 应用实例创建
│  ├─ plugins/supabase.ts    # 从 runtimeConfig 读取配置，注入 $supabase
│  ├─ pages/                # login、pairing 和首页；Nuxt 文件路由
│  ├─ assets/css/index.css   # Tailwind v4 入口与 @theme
│  ├─ styles/legacy.css      # 从 app.vue 提取的既有全局样式，保持原顺序
│  ├─ types/                 # 生成的 Database schema、兼容行类型与共享类型
│  └─ utils/                 # 消息、上传和诊断工具
├─ public/
│  ├─ couplespace-mark.svg    # 品牌图标
│  ├─ login-couple.jpg        # 登录页视觉资源
│  └─ models/Fox.glb          # 3D 宠物模型
├─ supabase/
│  ├─ migrations/             # baseline + align_schema，供全新本地初始化
│  ├─ legacy-migrations/      # 原 23 份迁移及来源 SHA-256 清单
│  ├─ scripts/                # 按依赖重新生成基础迁移
│  ├─ tests/                  # 独立的 PostgreSQL 兼容升级回归测试
│  └─ functions/              # AI、ZEGO Token、账户相关 Edge Functions
├─ android/                   # Capacitor Android 工程
├─ desktop/                   # Electron Windows 桌面壳
├─ infra/                     # 可选通话基础设施配置
├─ capacitor.config.json
├─ nuxt.config.ts
└─ package.json
```

### 基础层约定

保留 Nuxt 4 / Vue 3。`app.vue` 是 `<NuxtPage>` 入口，`composables/` 管理共享会话；不创建第二套 React 运行时。`app/pages/` 包含 `/login`、`/pairing` 和 `/`，全局守卫在浏览器恢复会话后按成员关系分发。原完整业务页面保存在 `app/legacy-app.vue`，当前首页先用于配对验收。数据库采用基础迁移、最终对齐及后续增量迁移，具体本地启动方式见下文。

`AppShell` 已接入应用，统一组合桌面 `SideNav` 与手机 `BottomNav`。导航使用 `items`、`active`、`unreadCount` 等 props，以及 `select`、`settings` 事件；组件不读取数据库。布局插槽为默认内容、`before`（页面提示）和 `overlays`（现有面板）。

通用组件可显式导入，也可以使用 Nuxt 默认自动导入名：`UiGlassCard`、`UiPageTransition`、`UiEmptyState`、`UiLoading`。例如：

```vue
<UiGlassCard as="section" padding="md">
  <UiEmptyState title="还没有共同回忆" description="从第一张照片开始。">
    <template #actions><button type="button">添加照片</button></template>
  </UiEmptyState>
</UiGlassCard>
<UiLoading variant="skeleton" label="正在加载回忆" :lines="3" />
<UiPageTransition :transition-key="currentPage"><div>页面内容</div></UiPageTransition>
```

`Loading` 与 `EmptyState` 已替换现有业务视图的重复加载和失败状态。`PageTransition` 提供可选的 200ms 进出过渡并尊重减少动态效果偏好；暂未包裹现有视图，避免改变“记录此刻”等操作对组件立即挂载的依赖。

`app/assets/css/index.css` 通过 Nuxt 的 `css` 配置全局加载，使用完整的 `@import "tailwindcss"` 入口（含 Preflight）。其后的 `legacy.css` 保留已有业务样式，`@theme inline` 保留现有语义色彩、展示字体和阴影映射，可继续使用 `bg-bg`、`text-ink`、`text-muted`、`text-accent`、`shadow-glass` 等工具类。

新增主题使用 `@theme static` 定义，确保变量即使暂未用于工具类也会输出，供组件直接通过 `var()` 读取：

```css
@theme static {
  --color-blush: #f5e6f0;
  --color-lavender: #c9a0dc;
  --color-rose-dust: #e8b4b8;
  --color-glass: rgba(255, 255, 255, 0.72);
  --font-sans: "Manrope", "Nunito Sans", sans-serif;
  --radius-card: 1.25rem;
}
```

对应工具类为 `bg-blush`、`text-lavender`、`bg-rose-dust`、`bg-glass`、`font-sans`、`rounded-card`。`GlassCard` 读取 `--radius-card`，默认圆角为 `1.25rem`，随根字号缩放。全局默认字体使用该字体栈；`font-aliases.css` 将已经安装的本地变量字体注册为主题指定的 `Manrope` 和 `Nunito Sans`，沿用原有字重和语言分段，不新增字体依赖或远程请求。

### Supabase 基础接口

- `app/lib/supabase.ts` 是唯一调用 SDK `createClient` 的位置。插件为每个 Nuxt 应用实例创建并注入客户端，避免服务器请求之间共享会话。缺少 URL 或 anon key 时返回 `null`，沿用现有本地演示模式。
- `useAuth()` 复用 `useCoupleAuth()` 的认证、配对和演示状态，返回接口保持一致；旧业务组件可以继续使用原 composable。
- `useSupabaseQuery<T>(query, options)` 接收 `(client, signal)` 查询回调，返回只读的 `data / error / count / status / pending`，以及 `execute / refresh / cancel / clear`。支持 `initialData`、`enabled`、`watch` 和 `immediate`。自动查询在组件挂载后开始，SSR 不自动请求；新请求和销毁会取消旧请求并忽略过期响应。将 signal 传给 SDK 的 `.abortSignal(signal)` 才能中止底层网络请求。
- `useRealtime(filter, onChange, options)` 包装 `postgres_changes`。filter 可为 ref 或 getter，包含 `event / schema / table / filter`；支持 `enabled`、`immediate`、`channelName`，返回 `configured / connected / status / error / subscribe / stop`。每次调用使用独立频道，参数变化或组件销毁时移除旧频道；回调可用 ref 更新。Presence 和通话继续使用原业务 composables。

这些 composables 在组件 setup 中调用；查询和订阅默认只在浏览器挂载后启动。未配置状态为 `unconfigured`，不会创建虚假查询结果。下一阶段使用实时功能前，需要在自己的 Supabase 项目为对应表启用 Realtime，并配置成员访问的 RLS。

`app/types/database.generated.ts` 是 Supabase CLI 从实际本地数据库生成完整 `Database` schema 的目标文件；在 `app/lib/supabase.ts` 使用 `createClient<Database>`，沿用 Nuxt 插件逐实例注入。`app/types/database.ts` 保留现有业务使用的兼容行类型。生成、接入与检查结果记录在 [验证报告](docs/FOUNDATION_VALIDATION.md)。

## 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/XTH-LOVE/Love.git
cd Love
npm install
```

Windows PowerShell：

```powershell
git clone https://github.com/XTH-LOVE/Love.git
Set-Location Love
npm install
Copy-Item .env.example .env.local
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env.local`，至少配置以下 Nuxt 变量。本地开发应使用 `npx supabase status` 输出的 URL 和 anon key；连接云端时再替换为自己的项目值：

```env
NUXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NUXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

可选能力：

- `NUXT_PUBLIC_AMAP_KEY`：高德地图 Web 端 Key。
- `NUXT_PUBLIC_AMAP_SECURITY_CODE`：高德安全密钥。
- `NUXT_PUBLIC_ZEGO_APP_ID`：ZEGO App ID。
- `NUXT_PUBLIC_ZEGO_SERVER`：ZEGO WebSocket 服务地址。
- `NUXT_PUBLIC_TURN_URLS`、`NUXT_PUBLIC_TURN_USERNAME`、`NUXT_PUBLIC_TURN_CREDENTIAL`：WebRTC 中继配置。

### 3. 初始化本地 Supabase

仓库已包含 Supabase CLI 开发依赖与 `supabase/config.toml`，无需再次运行 `supabase init`。先启动 Docker Desktop，并确认当前终端可以运行 `docker ps`。Windows 中若宿主机可运行 Docker、当前 shell 却找不到，应将实际安装目录的 `resources/bin` 加入该执行进程的 PATH；安装目录以本机为准。

活动迁移按文件名顺序自动应用：

| 文件 | 用途 |
| --- | --- |
| `20261026000000_baseline.sql` | 将 33 个原始来源按依赖合并，先创建业务表再升级，整份使用一个显式事务。 |
| `20261027162443_align_schema.sql` | 对齐字段、约束、索引、RLS、访问授权、辅助函数与私有 Storage。 |
| `20261029132447_pairing_rpc.sql` | 新增仅登录用户可调用的创建空间、加入空间 RPC。 |

原 23 份迁移完整保存在 `supabase/legacy-migrations/`，`baseline-sources.json` 记录全部来源的 SHA-256。`messages`、`couple_letters` 仍由当前应用使用；原失败原因是它们的建表脚本位于迁移目录外，而不是表已废弃。修改基础结构的来源后，运行 `node supabase/scripts/rebuild-baseline.mjs` 可重建基础迁移；来源中的事务外壳会被合并事务统一替代。

首次启动：

```bash
npx supabase start
npx supabase migration up
npx supabase status
```

首次会下载 Docker 镜像。`start` 已包含初始化与迁移，随后 `migration up` 用于确认无待应用文件。仅当确认本地数据可以丢弃、需要从零初始化时，执行 `npx supabase stop --no-backup` 后重新 `start`。

这套合并历史用于全新本地数据库。已有部署应保留自己的迁移记录并核对实际 schema；不要把这份基础迁移直接推送到已有云端数据库，也不要在旧库重放整套历史 SQL。

最终结构保留现有 `profiles / messages / album_photos` 等业务表及 RPC，新增 `memory_media / album_media / whispers` 与新字段。新旧日期、正文、相册名和纪念日重复设置通过兼容触发器同步；媒体和消息按原 ID 同步。成员角色为 `a / b`，每个空间各最多一人。`couple_members` 的直接读取限本人，伴侣资料通过现有 RPC 获取。

全部应用 public 表启用 RLS，策略仅面向 `authenticated`，UPDATE/ALL 明确填写 `WITH CHECK`；表授权按实际策略命令授予，`account_usernames` 继续禁止客户端直接访问。`whispers` 仅授予 `read_at` 列更新权限，阻止修改正文。`user_couple_ids()` 为 `SECURITY DEFINER`，使用空 `search_path` 并限制执行角色。

Storage 包含私有 `couple-media`，同时保留现有上传流程使用的 `memory-photos / album-media / message-media` 和头像 `avatars`。媒体对象按 `<couple_id>/...` 限定访问，消息路径还需 `messages` 子目录；不会移动已有对象或把旧 bucket 重命名。匿名角色不能读取私有媒体。

在 Studio 的 SQL Editor 或 psql 中执行安全验收：

```sql
select tablename, rowsecurity
from pg_tables where schemaname = 'public' order by tablename;

select tablename, policyname, cmd, roles, with_check
from pg_policies where schemaname = 'public' order by tablename;

select proname, prosecdef
from pg_proc where proname = 'user_couple_ids';

select id, public
from storage.buckets where id = 'couple-media';
```

预期：所有表 `rowsecurity=true`；策略 `roles={authenticated}`；所有 UPDATE 的 `with_check` 非空；辅助函数 `prosecdef=true`；`couple-media.public=false`。这组元数据检查不替代成员、非成员和匿名用户的访问测试。

从已启动并通过验收的本地数据库生成类型：

```bash
npm run db:gen-types
npx nuxt prepare
npx tsc --noEmit
npx tsc --noEmit --project .nuxt/tsconfig.app.json
npx tsc --noEmit --project .nuxt/tsconfig.server.json
npx tsc --noEmit --project .nuxt/tsconfig.shared.json
npx tsc --noEmit --project .nuxt/tsconfig.node.json
```

Nuxt 4 的根 `tsconfig.json` 采用 project references；因此除根命令外，需检查应用配置，避免空根项目掩盖应用错误。项目保留 Nuxt/Vue 的 `app/` 结构，客户端唯一入口为 `app/lib/supabase.ts`，不另建 React 的 `src/lib` 或使用 `VITE_SUPABASE_*`。

`db:gen-types` 从真实本地 Supabase 导出类型，成功后原子替换生成文件；CLI 报错时保留原有类型。

配对 RPC 接口：

```ts
// 创建者登录后调用，data 为新空间 UUID。
await supabase.rpc('create_couple', {
  p_name_a: '阿甲', p_name_b: '阿乙', p_start_date: '2023-05-20',
})
// 对方使用自己的登录会话，以及创建者提供的 UUID 调用。
await supabase.rpc('join_couple', { p_couple_id: sharedCoupleId })
```

两者均为固定空 search_path 的 SECURITY DEFINER 函数，仅授予 authenticated 执行权限。创建时绑定当前用户为 a，加入时绑定为 b；重复配对和已占用 b 的空间会被拒绝。昵称去掉首尾空格后需为 1–40 字，日期不可空。资料行锁、空间父行锁和唯一约束保护并发提交，couple_members 继续只允许本人读取，不开放直接新增。真实数据库回滚测试见 `supabase/tests/pairing-rpc.sql`。前端已接入两个 RPC，完整双账号操作见 [人工测试指南](docs/MANUAL_AUTH_TEST.md)。

将 `npx supabase status` 的本地值填入 `.env.local`：

```env
NUXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NUXT_PUBLIC_SUPABASE_ANON_KEY=<本地 anon key>
```

`.env.local` 已被 Git 忽略；不要填入 service-role key。Nuxt 启动和生成时用 `--dotenv .env.local` 显式加载它。

数据库兼容回归测试与应用依赖分开安装：

```bash
npm ci --prefix supabase/tests
npm test --prefix supabase/tests
```

测试使用 PGlite 与最小 Auth/Storage SQL 桩，验证历史数据、兼容字段、双向同步和权限回归；它不替代真实 Supabase 验收、Storage HTTP 上传、签名 URL 或 Realtime 测试。本轮真实数据库四项验收、五条 TypeScript 检查和 19 项前端单元测试均通过，详情见 [验证报告](docs/FOUNDATION_VALIDATION.md)。

再部署 Edge Functions：

```bash
npx supabase functions deploy account-auth
npx supabase functions deploy heart-ai
npx supabase functions deploy zego-token
```

Edge Function Secrets 应在 Supabase 控制台配置：

- `MIMO_API_KEY`
- `MIMO_BASE_URL`（可选）
- `MIMO_MODEL`（默认使用项目配置的 MiMo 模型）
- `ZEGO_SERVER_SECRET`

这些值只应该存在于服务端 Secrets 中，不要写进 `.env`、README、前端代码或提交记录。

### 4. 启动开发环境

```bash
npm run dev
```

开发脚本自动读取 `.env.local`，绑定 `http://127.0.0.1:3200/`。如果端口被占用，以终端输出为准；人工验收保持同一主机名，避免混用 localhost 和 127.0.0.1 的浏览器存储。本地确认邮件在 `http://127.0.0.1:54324/` 查看，并在注册账号对应的浏览器环境打开确认链接。

## 构建与发布

### 当前版本：带 AI 后端的 Nuxt Web 应用

当前分支包含 `server/api/ai/*`。公网部署请使用 `npm run build`，保留 Nitro
服务端来保护 DeepSeek Key；Supabase 连接参数通过托管平台的环境变量注入。
生产变量模板见 [.env.production.example](.env.production.example)，提交前执行
`npm run check:deploy`。检查说明见 [公网部署前检查](docs/PRE_DEPLOY_CHECK.md)。
本机 `.env.local` 仅用于开发，不提交、不复制到云端。

### 可选的静态构建（不含 Nuxt AI 后端）

```bash
npm run generate -- --dotenv .env.local
```

生成结果位于 `.output/public/`，可用于静态托管或移动端打包。这种构建不提供 Nuxt AI 后端接口。
上述命令使用本地开发配置，不是当前公网全栈版本的部署方式。

### Android APK

```bash
npm run android:apk
```

该命令会先生成静态网页、同步 Capacitor 工程，再构建 Debug APK。正式发布前请在 Android Studio 中配置签名和 Release 构建。

### Windows 桌面软件

```bash
npm run desktop:dev
npm run desktop:exe
```

Electron 桌面壳默认加载线上 Web 版本，因此网页业务更新不一定需要重新制作 EXE。安装包输出到 `desktop-dist/`。

### 版本更新

版本号维护在 `package.json` 和 Nuxt runtime config 中。网页和桌面端使用在线更新清单，Android 通过 APK 下载入口提示用户安装新版本。完整流程见 [APP_UPDATE.md](APP_UPDATE.md)。

## 安全与隐私设计

Love小家处理的是情侣之间的照片、视频、消息和位置，因此安全边界不是附加功能，而是核心设计：

- 每个用户属于一个情侣空间，业务查询以 `couple_id` 为边界。
- Supabase Postgres 使用 RLS 限制同一情侣空间之外的访问。
- 私密媒体使用 Storage 签名地址，不把公开永久文件 URL 作为主要访问方式。
- 前端只使用 Supabase anon key；service role key、ZEGO ServerSecret、AI Key 只允许放在服务端。
- AI 请求通过 Edge Function 转发，避免在浏览器暴露供应商密钥。
- 账户设置中不会显示用户密码，只提供修改或重置能力。
- 生产环境必须使用 HTTPS，并按实际部署域名配置认证回调地址。

## 当前状态

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| Web 登录与情侣空间 | ✅ 可用 | 需要配置 Supabase Auth 和数据库 |
| 首页、相册、时光、纪念日、清单 | ✅ 可用 | 支持真实数据和演示模式 |
| 双人实时文字与媒体消息 | ✅ 可用 | 需要消息表、Storage 和 Realtime |
| AI 约会、日记、情书 | ✅ 可用 | 需要部署 `heart-ai` 并配置 MiMo Secrets |
| 真实地图与位置分享 | 🧪 配置后可用 | 需要地图 Key、域名白名单和定位权限 |
| 音频/视频通话 | 🧪 配置后可用 | 需要 ZEGO ServerSecret、浏览器媒体权限 |
| 3D 宠物与成长系统 | 🚧 持续完善 | 当前已接入模型、皮肤、配饰和互动基础 |
| Android / Windows 发布 | ✅ 可构建 | 正式发布需要各平台签名和商店配置 |

## 路线图

- [ ] 更丰富的 3D 宠物模型、家具和动作系统。
- [ ] 共同宠物的成长阶段、任务和奖励。
- [ ] 更完整的系统级来电、通知和后台音频体验。
- [ ] 媒体上传断点续传、离线队列和更智能的本地缓存。
- [x] PWA 安装清单、Service Worker 离线应用壳和安装提示。
- [ ] 桌面通知和跨设备同步优化。
- [ ] 多语言界面与更完善的无障碍支持。
- [ ] 面向贡献者的组件文档和端到端测试。

## 贡献指南

欢迎提交 Issue、改进建议、UI 方案和 Pull Request。

1. Fork 本仓库并创建功能分支。
2. 保持修改范围清晰，避免把真实密钥、个人照片或生产数据提交到仓库。
3. 提交前运行：

   ```bash
   npx tsc --noEmit
   npm run generate
   git diff --check
   ```

4. 在 Pull Request 中说明：修改背景、实现方式、测试结果以及是否涉及数据库迁移。

## 常见问题

### 为什么登录后页面还是演示模式？

检查 `.env.local` 中的 Supabase URL 和 anon key，并确认启动时传入 `--dotenv .env.local`。部署环境应配置对应的 `NUXT_PUBLIC_SUPABASE_*` 变量，然后重新生成静态文件。

### 为什么通话提示 Token 无效？

ZEGO 的前端 App ID 不能替代 ServerSecret。请在 Supabase Edge Function Secrets 中配置真实 `ZEGO_SERVER_SECRET`，并确认 Edge Function 返回的 App ID 与前端一致。

### 为什么照片加载失败或很慢？

确认 Storage bucket、RLS、签名地址和部署域名配置正确。项目会使用签名地址、图片变换、浏览器 Cache Storage 和分批加载，但首次访问大视频仍然受网络和文件大小影响。

### 能不能只使用网页，不构建 APK？

可以。当前带 AI 后端的网页运行 `npm run build` 后部署到支持 Nuxt/Nitro 的服务环境。
Android 和 Windows 是额外的发布形态，不是 Web 使用的前置条件。

## 开源协议

本项目使用 [MIT License](LICENSE)。欢迎学习、修改和提交改进，也请在使用第三方服务时遵守对应服务条款和许可证。

## 支持项目

如果 Love小家对你有帮助，欢迎：

- 点一个 Star，让更多人看到这个项目。
- Fork 后做出你们自己的情侣空间主题。
- 提交一个 Issue，告诉我你最想要的功能。
- 分享给正在寻找私密共同空间的情侣或开发者。

<p align="center">
  <strong>愿每一段认真相爱的日常，都有一个值得回来的地方。</strong><br>
  <a href="https://github.com/XTH-LOVE/Love-">访问 GitHub 项目</a> ·
  <a href="https://love-home.pages.dev/">打开在线体验</a>
</p>
