import { defineEventHandler, sendStream, setHeader } from 'h3'
import { CHAT_REPLY_LIMIT, parseChatInput, type ChatEvent } from '#shared/utils/aiChat'
import { readSseData } from '#shared/utils/aiSse'
import { aiError, aiProvider, readAiInput, requireAiMember } from '../../utils/ai'

const systemPrompt = '你是一个温柔贴心的 AI 伴侣助手，正在陪一对情侣聊天。' +
  '用亲切、温暖、简短的中文回应，通常两到四句话。可以倾听心事、分享约会灵感、帮助双方温和表达。' +
  '你是 AI，请诚实说明这一点；不冒充真实恋人，不编造他们的共同经历。直接回应，不输出思考过程。'

export default defineEventHandler(async event => {
  const member = await requireAiMember(event)
  const input = await readAiInput(event, parseChatInput)
  if (event.node.res.destroyed) return
  const { key, model } = aiProvider(event, member.userId)
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, 45000)
  const disconnect = () => controller.abort()
  event.node.res.once('close', disconnect)
  try {
    let upstream: Response
    try {
      upstream = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST', signal: controller.signal,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ model, stream: true, thinking: { type: 'disabled' }, temperature: 0.8, max_tokens: 640,
          messages: [{ role: 'system', content: systemPrompt }, ...input.messages] }),
      })
    } catch {
      throw aiError(502, timedOut ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE', 'AI 暂时没有回应，请稍后重试。')
    }
    if (!upstream.ok || !upstream.body || !upstream.headers.get('content-type')?.includes('text/event-stream')) {
      void upstream.body?.cancel().catch(() => {})
      // 不读取或转发上游异常正文，以免包含请求内容或鉴权信息。
      throw upstream.status === 402
        ? aiError(503, 'AI_BALANCE_INSUFFICIENT', 'AI 服务额度暂时不足。')
        : aiError(502, 'AI_UNAVAILABLE', 'AI 暂时无法连接，请稍后重试。')
    }
    setHeader(event, 'Content-Type', 'text/event-stream; charset=utf-8')
    setHeader(event, 'Cache-Control', 'private, no-cache, no-store, no-transform')
    setHeader(event, 'X-Accel-Buffering', 'no')
    const encoder = new TextEncoder()
    const body = upstream.body
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      async start(output) {
        const emit = (data: ChatEvent) => { if (!cancelled) output.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)) }
        let text = '', done = false, truncated = false
        const heartbeat = setInterval(() => {
          if (!cancelled && !controller.signal.aborted) output.enqueue(encoder.encode(': keep-alive\n\n'))
        }, 10000)
        try {
          output.enqueue(encoder.encode(': connected\n\n'))
          for await (const frame of readSseData(body, controller.signal)) {
            if (frame === '[DONE]') { done = true; break }
            const data = JSON.parse(frame)
            if (data.error || !Array.isArray(data.choices)) throw new Error('Invalid provider event')
            const choice = data.choices[0]
            if (choice?.finish_reason === 'length') truncated = true
            const delta = choice?.delta?.content
            if (delta !== undefined && delta !== null && typeof delta !== 'string') throw new Error('Invalid delta')
            if (delta) {
              text += delta
              if ([...text].length > CHAT_REPLY_LIMIT) throw new Error('Reply too large')
              emit({ type: 'delta', text: delta })
            }
          }
          if (!done || !text.trim()) throw new Error('Incomplete provider stream')
          if (truncated) emit({ type: 'error', code: 'AI_RESPONSE_TRUNCATED' })
          else emit({ type: 'done' })
        } catch {
          if (!controller.signal.aborted || timedOut) emit({ type: 'error', code: timedOut ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE' })
        } finally {
          clearInterval(heartbeat)
          if (!cancelled) output.close()
        }
      },
      cancel() { cancelled = true; controller.abort() },
    })
    return await sendStream(event, stream)
  } finally {
    clearTimeout(timer)
    event.node.res.off('close', disconnect)
    controller.abort()
  }
})
