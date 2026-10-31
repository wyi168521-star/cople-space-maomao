# 首页恋爱数据看板

首页的 `HomeDashboard.vue` 使用 `useDashboard.ts`，在计时器下方显示四项统计：

| 卡片 | 统计口径 |
| --- | --- |
| 共同回忆 | 当前情侣的 `memories` 记录数 |
| 悄悄话 | 当前情侣的 `whispers` 记录数 |
| 珍藏照片 | 当前情侣的 `album_media` 与 `memory_media` 中 `media_type = 'photo'` 的记录数之和 |
| 已完成心愿 | 当前情侣的 `wishes` 中 `is_completed = true` 的记录数 |

照片按记录计数。同一张照片若分别存入相册和时光轴，将计为两条；视频不计入。

现有共同计划保存在 `together_items`。迁移
`20261030162043_dashboard_wishes_view.sql` 新增只读的 `wishes` 兼容视图，将
`completed` 映射为 `is_completed`，沿用已有记录。视图设置
`security_invoker = true`，使用底表的 RLS；匿名用户无访问权限。
此处依据 [PostgreSQL 视图权限说明](https://www.postgresql.org/docs/17/sql-createview.html)。

在其他开发环境启动前，先执行 `npx supabase migration up`，再执行
`npm run db:gen-types`。本地环境已应用迁移并重新生成类型。

查询使用五个并行的 HEAD 请求和 `count: 'exact'`，不下载数据列表。媒体表
通过父表的 `couple_id` 进行过滤，其他查询直接过滤当前 `couple_id`。
每项独立处理加载和错误；读取失败显示破折号及错误提示，点击刷新按钮可重试。
离开首页、退出登录或切换情侣空间时会取消旧请求，防止旧结果覆盖当前统计。

数字使用 Vue 和 `requestAnimationFrame` 在 650ms 内缓动显示；开启系统的
“减少动态效果”后直接显示最终数字。桌面为四列，手机为两列。

## 验证

- TypeScript 应用项目检查通过；现有 59 项单元测试通过。
- 本地 Supabase 与 Chrome 浏览器联测通过 11 项：空数据、计数口径、计时器位置、
  并行 HEAD 请求、空响应体错误、计数缺失错误、双方账号一致、RLS 隔离、
  桌面和手机布局、账号切换与旧请求取消、无浏览器运行异常。
- 测试只使用临时账号和情侣空间，测试数据已清理。

本阶段仅交付数据看板。每日盲盒和背景音乐尚未接入。
