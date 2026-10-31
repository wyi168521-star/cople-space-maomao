export type ChatTurn = { role: 'user' | 'assistant'; content: string }
export type ChatInput = { recentMessages: ChatTurn[]; summary: string }
export type ChatUsage = { promptTokens: number; completionTokens: number; cacheHitTokens: number }
export type ChatEvent = { type: 'delta'; text: string }
  | { type: 'done'; summary: string; trimmedCount: number; usage?: ChatUsage; summaryUsage?: ChatUsage }
  | { type: 'error'; code: string }

export const CHAT_USER_LIMIT = 2000
export const CHAT_WINDOW_LIMIT = 10
// 完整窗口之后，新发出的用户消息会临时成为第 11 条。
export const CHAT_HISTORY_LIMIT = CHAT_WINDOW_LIMIT + 1
export const CHAT_SUMMARIZE_COUNT = 4
export const CHAT_SUMMARY_LIMIT = 50
export const CHAT_CONTEXT_LIMIT = 16000
export const CHAT_REPLY_LIMIT = 50

export function parseChatInput(value: unknown): ChatInput {
  if (!value || typeof value !== 'object') throw new Error('请提交对话内容。')
  const input = value as Record<string, unknown>
  // messages 兼容尚未刷新的旧页面；新页面使用 recentMessages + summary。
  const turns = input.recentMessages ?? input.messages
  if (!Array.isArray(turns) || !turns.length || turns.length > CHAT_HISTORY_LIMIT) {
    throw new Error(`请提交 1 至 ${CHAT_HISTORY_LIMIT} 条对话。`)
  }
  const messages = turns.map((turn: unknown, index: number): ChatTurn => {
    if (!turn || typeof turn !== 'object' || !('role' in turn) || !('content' in turn)
      || (turn.role !== 'user' && turn.role !== 'assistant') || typeof turn.content !== 'string') {
      throw new Error('对话仅接受 user / assistant 角色和文字内容。')
    }
    const content = turn.content.trim()
    const limit = turn.role === 'user' ? CHAT_USER_LIMIT : CHAT_REPLY_LIMIT
    if (!content || [...content].length > limit) throw new Error(`每条${turn.role === 'user' ? '消息' : '回复'}最多 ${limit} 个字，且不能为空。`)
    if (turn.role !== (index % 2 ? 'assistant' : 'user')) throw new Error('对话须从 user 开始，并按 user / assistant 交替排列。')
    // 不转发客户端传入的 system、工具、模型或其他字段。
    return { role: turn.role, content }
  })
  if (messages.at(-1)?.role !== 'user') throw new Error('最后一条对话必须是你的消息。')
  if (messages.reduce((total, turn) => total + [...turn.content].length, 0) > CHAT_CONTEXT_LIMIT) {
    throw new Error('对话内容太长，请清空后重新开始。')
  }
  const summary = input.summary === undefined ? '' : input.summary
  if (typeof summary !== 'string' || [...summary].length > CHAT_SUMMARY_LIMIT) throw new Error(`历史摘要最多 ${CHAT_SUMMARY_LIMIT} 个字。`)
  return { recentMessages: messages, summary: summary.trim() }
}

/** 只读取数字统计，不转发上游响应、请求或私有字段。 */
export function chatUsage(value: unknown): ChatUsage | undefined {
  if (!value || typeof value !== 'object') return
  const usage = value as Record<string, unknown>
  const number = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
  return { promptTokens: number(usage.prompt_tokens), completionTokens: number(usage.completion_tokens), cacheHitTokens: number(usage.prompt_cache_hit_tokens) }
}

export function chatNotice(code: string) {
  const notices: Record<string, string> = {
    AI_NOT_CONFIGURED: 'AI 尚未配置，先用本地回复陪陪你。',
    AI_BALANCE_INSUFFICIENT: 'AI 服务额度暂时不足，先送你一句本地回复。',
    AI_RATE_LIMITED: '聊得有点快，休息一会儿再试吧。',
    AUTH_REQUIRED: '请先登录，再与 AI 聊天。',
    PAIRING_REQUIRED: '请先加入情侣空间，再来聊天。',
    AUTH_UNAVAILABLE: '暂时无法验证登录状态，先用本地回复陪陪你。',
    AI_TIMEOUT: 'AI 回应超时了，可以稍后再试。',
    AI_RESPONSE_TRUNCATED: '这次回复未能完整生成，可以继续追问。',
    AI_SUMMARY_UNAVAILABLE: '大毛整理回忆时打了个小盹，请再试一次。已有记忆仍保留着。',
  }
  return notices[code] || 'AI 暂时没有连接上，可以稍后再试。'
}

export const LOCAL_CHAT_REPLIES = [
  '哼，才不是特意等你。今天累不累？过来，大毛先给你一个抱抱。',
  '嘴上说你笨，心里可护着你呢。慢慢说，大毛认真听着。',
  '别一个人硬扛啦。先喝口水，剩下的我们一点点来，好不好？',
]
