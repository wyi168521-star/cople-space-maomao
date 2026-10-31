import { createError, getHeader, readBody, setHeader, type H3Event } from 'h3'
import { $fetch } from 'ofetch'
import type { AIFeature, AIResponse } from '#shared/types/ai'
import { createAiRateLimiter } from './aiRateLimit'

const allowed = createAiRateLimiter()
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function aiError(statusCode: number, code: string, message: string) {
  return createError({ statusCode, message, data: { code } })
}

/** 验证真实 Supabase 会话及自己的配对关系，不信任前端传来的 user_id/couple_id。 */
export async function requireAiMember(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const authorization = getHeader(event, 'authorization') || ''
  if (!/^Bearer [A-Za-z0-9._~-]+$/.test(authorization) || authorization.length > 8192) {
    throw aiError(401, 'AUTH_REQUIRED', '请先登录，再使用 AI 功能。')
  }
  const config = useRuntimeConfig(event)
  const base = String(config.public.supabaseUrl || '').replace(/\/$/, '')
  const anonKey = String(config.public.supabaseAnonKey || '')
  if (!base || !anonKey) throw aiError(503, 'AUTH_UNAVAILABLE', '登录服务暂时不可用。')
  const options = { headers: { apikey: anonKey, Authorization: authorization }, timeout: 5000, retry: 0 }
  let user: { id?: string }
  try { user = await $fetch<{ id?: string }>(`${base}/auth/v1/user`, options) }
  catch (error) {
    const status = error && typeof error === 'object' && 'statusCode' in error ? Number(error.statusCode) : 0
    throw status === 401 || status === 403
      ? aiError(401, 'AUTH_REQUIRED', '登录已过期，请重新登录。')
      : aiError(503, 'AUTH_UNAVAILABLE', '暂时无法验证登录状态，请稍后重试。')
  }
  if (!user.id || !uuid.test(user.id)) throw aiError(401, 'AUTH_REQUIRED', '登录状态无效。')
  let members: { couple_id: string }[]
  try {
    members = await $fetch<{ couple_id: string }[]>(`${base}/rest/v1/couple_members`, {
      ...options, query: { select: 'couple_id', user_id: `eq.${user.id}`, limit: 1 },
    })
  } catch { throw aiError(503, 'AUTH_UNAVAILABLE', '暂时无法读取配对信息，请稍后重试。') }
  if (!Array.isArray(members) || !members[0]?.couple_id || !uuid.test(members[0].couple_id)) {
    throw aiError(403, 'PAIRING_REQUIRED', '请先加入情侣空间，再使用 AI 功能。')
  }
  return { userId: user.id, coupleId: members[0].couple_id }
}

export async function readAiInput<T>(event: H3Event, parse: (input: unknown) => T): Promise<T> {
  if (!getHeader(event, 'content-type')?.toLowerCase().startsWith('application/json')) {
    throw aiError(415, 'INVALID_INPUT', '请使用 JSON 格式提交。')
  }
  if (Number(getHeader(event, 'content-length') || 0) > 65536) throw aiError(413, 'INPUT_TOO_LARGE', '请求内容太长，请减少回忆数量。')
  let body: unknown
  try { body = await readBody<unknown>(event) }
  catch { throw aiError(400, 'INVALID_INPUT', '无法读取请求内容。') }
  if (new TextEncoder().encode(JSON.stringify(body) || '').length > 65536) throw aiError(413, 'INPUT_TOO_LARGE', '请求内容太长。')
  try { return parse(body) }
  catch (error) { throw aiError(400, 'INVALID_INPUT', error instanceof Error ? error.message : '请求内容不正确。') }
}

export async function generateAiText(event: H3Event, userId: string, kind: AIFeature, system: string, input: unknown): Promise<AIResponse> {
  const config = useRuntimeConfig(event)
  const key = String(config.deepseekApiKey || process.env.DEEPSEEK_API_KEY || '').trim()
  const model = String(config.deepseekModel || 'deepseek-flash').trim()
  if (!key) throw aiError(503, 'AI_NOT_CONFIGURED', 'AI 尚未配置，将为你使用本地内容。')
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(model)) throw aiError(503, 'AI_NOT_CONFIGURED', 'AI 模型配置无效。')
  if (!allowed(userId)) throw aiError(429, 'AI_RATE_LIMITED', '生成得有点频繁，休息一会儿再试吧。')

  let response: { choices?: { message?: { content?: unknown }; finish_reason?: string }[] }
  try {
    response = await $fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST', retry: 0, timeout: kind === 'quote' ? 20000 : 30000,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: { model, stream: false, thinking: { type: 'disabled' }, temperature: 0.8,
        max_tokens: kind === 'quote' ? 128 : 900,
        messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(input) }] },
    })
  } catch (error) {
    // 不返回上游异常对象：其中可能包含 Authorization、请求体和私人回忆。
    const status = error && typeof error === 'object' && 'statusCode' in error ? Number(error.statusCode) : 0
    if (status === 402) throw aiError(503, 'AI_BALANCE_INSUFFICIENT', 'AI 服务额度暂时不足，将使用本地内容。')
    throw aiError(502, 'AI_UNAVAILABLE', 'AI 暂时没有回应，请稍后重试。')
  }
  const choice = response?.choices?.[0]
  if (typeof choice?.message?.content !== 'string' || choice.finish_reason === 'length') {
    throw aiError(502, 'AI_INVALID_RESPONSE', 'AI 未返回完整内容，请稍后重试。')
  }
  let text = choice.message.content.trim()
  if (kind === 'quote') text = text.replace(/^[“”"'「」]+|[“”"'「」]+$/g, '').replace(/\s+/g, '')
  if (!text || [...text].length > (kind === 'quote' ? 20 : 1000)) {
    throw aiError(502, 'AI_INVALID_RESPONSE', 'AI 返回的内容格式不正确，请稍后重试。')
  }
  return { text, source: 'ai' }
}
