# DeepSeek：情话与回忆日记

已实现两个 Nuxt 服务端接口、`app/composables/useAI.ts`、首页每日情话卡片及
时光轴日记预览。首页在挂载且配对信息就绪后自动获取情话，传入双方昵称和以北京时间
起算的完整天数；同次挂载不会因为重复的状态通知发起重复请求。卡片带淡入、加载及重试。

时光轴顶部的魔法棒按钮读取当前列表中北京时间今天的回忆。没有今日记录时显示引导，
不发起生成。超出 20 条或文字预算时公平节选，并在界面注明。日记在原生 dialog 中
每 24ms 按完整字素显示，支持“显示全文”、Esc、关闭按钮、点击背景关闭及焦点恢复。
关闭和卸载会取消等待与打字计时器；系统开启减少动态效果时直接展示全文。
结果为预览，用户可选中文字复制留存，不会自动写入数据库。

## 配置密钥

在项目根目录的 `.env.local` 中填写：

```dotenv
DEEPSEEK_API_KEY=你的真实APIKey
DEEPSEEK_MODEL=deepseek-flash
```

本地文件中已补上空的 Key 占位，未覆盖任何既有值。填写后重启 `npm run dev`。
`.env.local` 已被 Git 忽略。密钥只写在这里或服务端的环境配置中，不放入
`NUXT_PUBLIC_` 变量、页面代码、Supabase 表或浏览器存储。

生产环境使用与私有配置字段匹配的 `NUXT_DEEPSEEK_API_KEY` 和
`NUXT_DEEPSEEK_MODEL`；服务端请求时也支持直接读取 `DEEPSEEK_API_KEY`。
真实密钥不作为 Nuxt 构建默认值写进产物。生产配置模板见 `.env.production.example`。
服务器部署需要运行 Nitro，单纯上传 `nuxt generate` 的静态文件不会运行这些接口。

模型调整说明：DeepSeek 官方已宣布 `deepseek-chat` / `deepseek-reasoner` 于
2026-07-24 停用；当前模型默认使用 `deepseek-flash`，可通过私有模型变量调整。
请求仍为 OpenAI 兼容格式，发送至固定的 `https://api.deepseek.com/chat/completions`。
采用非流式输出并关闭思考模式，减少短情话生成的延迟与额外 token 消耗。

参考：[DeepSeek 更新记录](https://api-docs.deepseek.com/updates/)、
[Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)、
[Nuxt runtimeConfig](https://nuxt.com/docs/4.x/guide/going-further/runtime-config)。

## 接口约定

两个接口均要求 `Authorization: Bearer <Supabase access_token>` 和 JSON 请求体。
服务端向 Supabase 验证用户，再以该会话查询自己的配对关系；不接受前端伪造的
`user_id` 或 `couple_id` 来决定权限。不使用 Supabase service role。

`POST /api/ai/love-quote`：

```json
{ "coupleName": "小林 & 小许", "daysTogether": 520 }
```

返回不超过 20 个 Unicode 字符的中文情话：

```json
{ "text": "有你在，平凡的日子也会发光。", "source": "ai" }
```

`POST /api/ai/daily-diary`：

```json
{
  "memories": [
    { "title": "一起散步", "body": "看见了晚霞", "location": "公园", "date": "2026-10-31" }
  ]
}
```

成功返回相同的 `{ text, source: 'ai' }` 结构，日记目标长度约 300 字。
只发送选中的标题、正文、地点及日期，不发送照片路径或其他数据库元数据。
每天最多 20 条回忆，每条正文最多 1500 字，合计最多 12000 字。

会话/配对错误分别返回 401/403；输入不合法返回 400；未配置 Key 返回 503，
错误码为 `AI_NOT_CONFIGURED`。上游返回 402 时转为安全的
`AI_BALANCE_INSUFFICIENT`，前端说明额度不足并继续使用本地兜底。
其他上游失败或内容格式异常返回 502，
不会透传含凭据或私密回忆的上游异常对象。所有响应使用 `Cache-Control: no-store`。

认证请求每次超时 5 秒；情话/日记生成分别超时 20/30 秒，均不自动重试。
每个已验证用户每 10 分钟最多生成 20 次。当前限流为单服务实例内存计数，
多实例部署时需要接入共享限流存储。

## 前端调用

```ts
const {
  loveQuote, quoteLoading, quoteIsFallback, quoteNotice,
  diary, diaryLoading, diaryIsFallback, diaryNotice,
  fetchLoveQuote, generateDiary, cancel,
} = useAI()

await fetchLoveQuote({ coupleName: '小林 & 小许', daysTogether: 520 })
await generateDiary([{ title: '一起散步', body: '看见了晚霞', location: '公园' }])
```

组合式函数只访问同源 Nuxt API，并自动附带当前 Supabase 会话。
方法返回字符串；被新请求替代、取消或账号变化后的旧请求返回 `null`。
组件卸载和切换账号时会取消请求，清空旧日记。会话读取及整体等待都有超时。

任何请求失败时，情话使用按北京时间日期和情侣编号稳定选取的本地预设；
日记使用所选记忆做本地整理，通过 `diaryIsFallback` 和 `diaryNotice` 明确标记，
不冒充 AI 生成。没有回忆时不会编造经历。页面应把结果作为纯文本展示，勿使用 `v-html`。

## 验证范围

前后端 TypeScript 检查通过。测试覆盖认证、配对、输入限制、密钥不进入响应、
上游错误脱敏、生成限流、空/超长/截断结果、本地兜底、超时及账号切换。
本地 Nitro + Supabase + Chrome 的联测覆盖真实会话与缺少 Key 的行为，
并确认浏览器运行配置中没有 DeepSeek 私有字段。

当前真实 Key 已配置并验证有效，模型列表包含 `deepseek-flash`。账户充值后，
`is_available` 已返回 true，两个真实生成接口均返回 HTTP 200 和 `source: 'ai'`，
并通过浏览器确认首页情话和今日日记实际展示成功。额度不足时的明确提示与本地兜底仍保留。
情话提示词优先生成 8–14 字，保持含标点不超过 20 字；日记提示词目标为 260–340 字。

前后端类型检查及 88 项测试通过。另通过 11 项浏览器联测，覆盖首页自动调用与参数、
本地兜底重试、空记录、北京时间筛选、打字与跳过、取消、手机和减少动态效果、账号切换、
真实情话和日记生成、额度不足响应及无浏览器异常；临时测试数据均已清理。

本次联测还发现本机局域网地址已变化，已仅更新 `.env.local` 的公开 Supabase 地址并
重启开发服务，保留私有密钥和其他配置。本机预览可使用 `http://127.0.0.1:3200/`；
其他设备需要使用电脑当前的局域网 IP。
