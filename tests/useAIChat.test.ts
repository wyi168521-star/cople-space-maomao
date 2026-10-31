import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref, type EffectScope } from 'vue'
import { useAIChat } from '../app/composables/useAIChat'

let scope: EffectScope
const user = ref<{ id: string } | null>({ id: 'user-a' })
const profile = ref<{ coupleId: string } | null>({ coupleId: 'couple-a' })
const session = vi.fn(), request = vi.fn()
const encoder = new TextEncoder()
const frame = (event: unknown) => encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
function response() {
  return new Response(new ReadableStream({ start(controller) {
    controller.enqueue(frame({ type: 'delta', text: '抱抱你💜' }))
    controller.enqueue(frame({ type: 'done' })); controller.close()
  } }), { headers: { 'Content-Type': 'text/event-stream' } })
}
function setup() { scope = effectScope(); return scope.run(() => useAIChat())! }
async function flush() { for (let index = 0; index < 20; index++) await Promise.resolve() }
beforeEach(() => {
  user.value = { id: 'user-a' }; profile.value = { coupleId: 'couple-a' }
  session.mockReset().mockResolvedValue({ error: null, data: { session: { user: { id: 'user-a' }, access_token: 'test-session' } } })
  request.mockReset().mockImplementation(async () => response())
  vi.stubGlobal('useNuxtApp', () => ({ $supabase: { auth: { getSession: session } } }))
  vi.stubGlobal('useAuth', () => ({ user, profile }))
  vi.stubGlobal('fetch', request)
})
afterEach(() => { scope?.stop(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('useAIChat streaming state', () => {
  it('uses same-origin authenticated fetch and passes previous turns without storing them', async () => {
    const chat = setup()
    await chat.sendMessage('你好')
    expect(chat.messages.value.map(message => message.content)).toEqual(['你好', '抱抱你💜'])
    expect(chat.loading.value).toBe(false)
    await chat.sendMessage('还想聊聊')
    expect(request.mock.calls[1]![0]).toBe('/api/ai/chat')
    expect(request.mock.calls[1]![1].headers.Authorization).toBe('Bearer test-session')
    expect(JSON.parse(request.mock.calls[1]![1].body).messages).toEqual([
      { role: 'user', content: '你好' }, { role: 'assistant', content: '抱抱你💜' }, { role: 'user', content: '还想聊聊' },
    ])
  })
  it('keeps the sending lock while deltas arrive, then allows another turn', async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>
    request.mockResolvedValue(new Response(new ReadableStream({ start(controller) { stream = controller } }), { headers: { 'Content-Type': 'text/event-stream' } }))
    const chat = setup(), pending = chat.sendMessage('慢慢说')
    await flush()
    stream.enqueue(frame({ type: 'delta', text: '第一段' })); await flush()
    expect(chat.messages.value.at(-1)?.content).toBe('第一段')
    expect(chat.loading.value).toBe(true)
    await chat.sendMessage('重复点击')
    expect(request).toHaveBeenCalledTimes(1)
    stream.enqueue(frame({ type: 'done' })); stream.close(); await pending
    expect(chat.loading.value).toBe(false)
  })
  it('shows a local reply and quota notice on 402 mapping', async () => {
    request.mockResolvedValue(new Response(JSON.stringify({ data: { code: 'AI_BALANCE_INSUFFICIENT' } }), { status: 503 }))
    const chat = setup()
    await chat.sendMessage('你好')
    expect(chat.messages.value.at(-1)?.source).toBe('local')
    expect(chat.messages.value.at(-1)?.content).toBeTruthy()
    expect(chat.notice.value).toContain('额度暂时不足')
    expect(chat.loading.value).toBe(false)
  })
  it('preserves partial text if the stream ends without done', async () => {
    request.mockResolvedValue(new Response(new ReadableStream({ start(controller) {
      controller.enqueue(frame({ type: 'delta', text: '未完成的内容' })); controller.close()
    } }), { headers: { 'Content-Type': 'text/event-stream' } }))
    const chat = setup()
    await chat.sendMessage('你好')
    expect(chat.messages.value.at(-1)).toMatchObject({ content: '未完成的内容', status: 'partial', source: 'ai' })
    expect(chat.notice.value).toContain('未完成回复')
  })
  it('stops pending reads, discards late output and clears on account changes', async () => {
    request.mockImplementation(async () => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(frame({ type: 'delta', text: '已经收到' }))
    } }), { headers: { 'Content-Type': 'text/event-stream' } }))
    const chat = setup(), pending = chat.sendMessage('你好')
    await flush(); chat.stop(); await pending
    expect(chat.messages.value.at(-1)?.status).toBe('stopped')
    expect(chat.loading.value).toBe(false)
    expect(chat.messages.value.at(-1)?.source).toBe('ai')
    user.value = { id: 'user-b' }
    expect(chat.messages.value).toHaveLength(0)
    expect(chat.notice.value).toBe('')
  })
  it('bounds a stuck session and cancels pending work on disposal', async () => {
    vi.useFakeTimers()
    session.mockImplementation(() => new Promise(() => {}))
    const chat = setup(), first = chat.sendMessage('你好')
    await vi.advanceTimersByTimeAsync(5001); await first
    expect(chat.loading.value).toBe(false)
    expect(chat.messages.value.at(-1)?.source).toBe('local')
    const second = chat.sendMessage('再试一次')
    scope.stop(); await second
    expect(chat.messages.value).toHaveLength(0)
    expect(request).not.toHaveBeenCalled()
  })
})
