export type ChatTurn = { role: 'user' | 'assistant'; content: string }
export type ChatEvent = { type: 'delta'; text: string } | { type: 'done' }
  | { type: 'error'; code: string }

export const CHAT_USER_LIMIT = 2000
export const CHAT_HISTORY_LIMIT = 21
export const CHAT_CONTEXT_LIMIT = 16000
export const CHAT_REPLY_LIMIT = 6000

export function parseChatInput(value: unknown): { messages: ChatTurn[] } {
  if (!value || typeof value !== 'object' || !('messages' in value) || !Array.isArray(value.messages)
    || !value.messages.length || value.messages.length > CHAT_HISTORY_LIMIT) {
    throw new Error(`请提交 1 至 ${CHAT_HISTORY_LIMIT} 条对话。`)
  }
  const messages = value.messages.map((turn: unknown): ChatTurn => {
    if (!turn || typeof turn !== 'object' || !('role' in turn) || !('content' in turn)
      || (turn.role !== 'user' && turn.role !== 'assistant') || typeof turn.content !== 'string') {
      throw new Error('对话仅接受 user / assistant 角色和文字内容。')
    }
    const content = turn.content.trim()
    const limit = turn.role === 'user' ? CHAT_USER_LIMIT : CHAT_REPLY_LIMIT
    if (!content || [...content].length > limit) throw new Error(`每条${turn.role === 'user' ? '消息' : '回复'}最多 ${limit} 个字，且不能为空。`)
    // 不转发客户端传入的 system、工具、模型或其他字段。
    return { role: turn.role, content }
  })
  if (messages.at(-1)?.role !== 'user') throw new Error('最后一条对话必须是你的消息。')
  if (messages.reduce((total, turn) => total + [...turn.content].length, 0) > CHAT_CONTEXT_LIMIT) {
    throw new Error('对话内容太长，请清空后重新开始。')
  }
  return { messages }
}

/** 保留最近的上下文；界面仍能查看本次页面内更早的对话。 */
export function recentChatTurns(turns: ChatTurn[]): ChatTurn[] {
  const recent = turns.slice(-CHAT_HISTORY_LIMIT)
  let count = recent.reduce((sum, turn) => sum + [...turn.content].length, 0)
  while (recent.length > 1 && (count > CHAT_CONTEXT_LIMIT || recent[0]?.role !== 'user')) {
    count -= [...recent.shift()!.content].length
  }
  return recent
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
  }
  return notices[code] || 'AI 暂时没有连接上，可以稍后再试。'
}

export const LOCAL_CHAT_REPLIES = [
  '先把烦恼放一放，好吗？送你一个小小的拥抱，今天也要对自己温柔一点。',
  '想念有时候不需要很长的话。一句“今天也想你”，就足够让普通的一天变暖。',
  '要不要给彼此留一句小纸条？写下今天最想说的那句话，也是一份很可爱的惊喜。',
]
