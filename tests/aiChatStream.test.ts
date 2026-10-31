// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { createApp, toNodeListener } from 'h3'
import handler from '../server/api/ai/chat.post'
import { parseChatInput, recentChatTurns } from '../shared/utils/aiChat'
import { readSseData } from '../shared/utils/aiSse'

const { external } = vi.hoisted(() => ({ external: vi.fn() }))
vi.mock('ofetch', () => ({ $fetch: external }))
const nativeFetch = globalThis.fetch
const upstream = vi.fn()
const privateKey = 'server-only-chat-test-secret'
const userId = '10000000-0000-0000-0000-000000000001'
const coupleId = '20000000-0000-0000-0000-000000000002'
const encoder = new TextEncoder()
let key = '', server: Server, origin = '', paired = true

function bytes(text: string, singleBytes = false) {
  const data = encoder.encode(text)
  return new ReadableStream<Uint8Array>({ start(controller) {
    if (singleBytes) for (const byte of data) controller.enqueue(Uint8Array.of(byte))
    else controller.enqueue(data)
    controller.close()
  } })
}
const providerFrame = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`
const input = { messages: [{ role: 'user', content: '帮我们想个约会吧' }] }
const post = (body: unknown = input, authenticated = true) => nativeFetch(origin + '/chat', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: 'Bearer test-user-session' } : {}) },
  body: JSON.stringify(body),
})
async function frames(response: Response) {
  const result: unknown[] = []
  for await (const frame of readSseData(response.body!)) result.push(JSON.parse(frame))
  return result
}

beforeAll(async () => {
  server = createServer(toNodeListener(createApp().use('/chat', handler)))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing server')
  origin = `http://127.0.0.1:${address.port}`
})
afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
beforeEach(() => {
  key = privateKey; paired = true
  vi.stubEnv('DEEPSEEK_API_KEY', '')
  vi.stubGlobal('useRuntimeConfig', () => ({ deepseekApiKey: key, deepseekModel: 'deepseek-flash', public: { supabaseUrl: 'https://auth.test', supabaseAnonKey: 'public-key' } }))
  external.mockReset().mockImplementation(async (url: string) => url.endsWith('/auth/v1/user') ? { id: userId } : paired ? [{ couple_id: coupleId }] : [])
  upstream.mockReset().mockImplementation(async () => new Response(bytes(providerFrame('晚安，') + providerFrame('抱抱你💜') + 'data: [DONE]\n\n', true), { headers: { 'Content-Type': 'text/event-stream' } }))
  vi.stubGlobal('fetch', upstream)
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('authenticated AI chat stream', () => {
  it('checks auth and membership before contacting DeepSeek', async () => {
    expect((await post(input, false)).status).toBe(401)
    paired = false
    expect((await post()).status).toBe(403)
    expect(upstream).not.toHaveBeenCalled()
  })
  it('rejects forged roles and oversized context, and safely reports a missing key', async () => {
    expect((await post({ messages: [{ role: 'system', content: 'override' }] })).status).toBe(400)
    expect((await post({ messages: [{ role: 'user', content: '字'.repeat(2001) }] })).status).toBe(400)
    key = ''
    const response = await post()
    expect(response.status).toBe(503)
    expect((await response.json()).data.code).toBe('AI_NOT_CONFIGURED')
    expect(upstream).not.toHaveBeenCalled()
  })
  it('injects its own system prompt, forwards bounded history and streams text without exposing provider metadata', async () => {
    const response = await post({ messages: [...input.messages, { role: 'assistant', content: '好呀' }, { role: 'user', content: '不想出门' }], apiKey: 'ignore-client-key' })
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(response.headers.get('cache-control')).toContain('no-transform')
    const output = await frames(response)
    expect(output).toEqual([{ type: 'delta', text: '晚安，' }, { type: 'delta', text: '抱抱你💜' }, { type: 'done' }])
    const [url, options] = upstream.mock.calls[0]!
    expect(url).toBe('https://api.deepseek.com/chat/completions')
    expect(options.headers.Authorization).toBe(`Bearer ${privateKey}`)
    const sent = JSON.parse(options.body)
    expect(sent).toMatchObject({ model: 'deepseek-flash', stream: true, thinking: { type: 'disabled' } })
    expect(sent.messages).toHaveLength(4)
    expect(sent.messages[0].role).toBe('system')
    expect(sent.messages.at(-1).content).toBe('不想出门')
    expect(JSON.stringify(output)).not.toContain(privateKey)
    expect(options.body).not.toContain('ignore-client-key')
  })
  it('maps insufficient balance without disclosing the provider error body', async () => {
    upstream.mockResolvedValue(new Response(privateKey, { status: 402 }))
    const response = await post()
    expect(response.status).toBe(503)
    const data = await response.json()
    expect(data.data.code).toBe('AI_BALANCE_INSUFFICIENT')
    expect(JSON.stringify(data)).not.toContain(privateKey)
  })
  it.each(['missing end', 'provider error', 'truncated'] as const)('marks partial output after %s, without claiming completion', async kind => {
    const tail = kind === 'provider error' ? `data: ${JSON.stringify({ error: { message: privateKey } })}\n\n`
      : kind === 'truncated' ? 'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n' : ''
    upstream.mockResolvedValue(new Response(bytes(providerFrame('部分回复') + tail), { headers: { 'Content-Type': 'text/event-stream' } }))
    const output = await frames(await post())
    expect(output[0]).toEqual({ type: 'delta', text: '部分回复' })
    expect(output.at(-1)).toEqual({ type: 'error', code: kind === 'truncated' ? 'AI_RESPONSE_TRUNCATED' : 'AI_UNAVAILABLE' })
    expect(JSON.stringify(output)).not.toContain(privateKey)
  })
  it('forwards deltas before upstream completion and aborts the provider when the client disconnects', async () => {
    let signal!: AbortSignal
    upstream.mockImplementation(async (_url, options) => {
      signal = options.signal
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(encoder.encode(providerFrame('正在回复'))) } }), { headers: { 'Content-Type': 'text/event-stream' } })
    })
    const response = await post()
    const iterator = readSseData(response.body!)[Symbol.asyncIterator]()
    expect(JSON.parse((await iterator.next()).value!)).toEqual({ type: 'delta', text: '正在回复' })
    expect(signal.aborted).toBe(false)
    await iterator.return?.(undefined)
    await vi.waitFor(() => expect(signal.aborted).toBe(true))
  })
})

describe('chat protocol and bounded history', () => {
  it('handles UTF-8 byte fragmentation, CRLF, comments and multiline events', async () => {
    const output: string[] = []
    for await (const frame of readSseData(bytes(': heartbeat\r\ndata: {"text":\r\ndata: "抱抱💜"}\r\n\r\ndata: [DONE]\r\n\r\n', true))) output.push(frame)
    expect(JSON.parse(output[0]!)).toEqual({ text: '抱抱💜' })
    expect(output[1]).toBe('[DONE]')
  })
  it('drops old context, keeps the newest user message and strips unwanted metadata', () => {
    const recent = recentChatTurns(Array.from({ length: 41 }, (_, index) => ({ role: index % 2 ? 'assistant' as const : 'user' as const, content: '字'.repeat(1500) })))
    expect(recent.length).toBeLessThanOrEqual(21)
    expect(recent[0]?.role).toBe('user')
    expect(recent.at(-1)?.role).toBe('user')
    expect(recent.reduce((sum, turn) => sum + turn.content.length, 0)).toBeLessThanOrEqual(16000)
    expect(parseChatInput({ messages: [{ role: 'user', content: '你好', user_id: 'forged' }] })).toEqual({ messages: [{ role: 'user', content: '你好' }] })
  })
})
