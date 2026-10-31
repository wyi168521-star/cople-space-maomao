import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref, type EffectScope } from 'vue'
import { useAI } from '../app/composables/useAI'

let scope: EffectScope
const user = ref<{ id: string } | null>({ id: 'user-a' })
const profile = ref<{ coupleId: string } | null>({ coupleId: 'couple-a' })
const session = vi.fn(), fetchApi = vi.fn()
const input = { coupleName: '小林 & 小许', daysTogether: 520 }
function setup() { scope = effectScope(); return scope.run(() => useAI())! }
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve() }

beforeEach(() => {
  user.value = { id: 'user-a' }; profile.value = { coupleId: 'couple-a' }
  session.mockReset().mockResolvedValue({ data: { session: { user: { id: 'user-a' }, access_token: 'supabase-session-token' } }, error: null })
  fetchApi.mockReset().mockResolvedValue({ text: '有你在，日子就有光。', source: 'ai' })
  vi.stubGlobal('useNuxtApp', () => ({ $supabase: { auth: { getSession: session } } }))
  vi.stubGlobal('useAuth', () => ({ user, profile }))
  vi.stubGlobal('$fetch', fetchApi)
})
afterEach(() => { scope?.stop(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('useAI without page integration', () => {
  it('calls only the same-origin Nuxt route with a Supabase session, not a model key', async () => {
    const ai = setup()
    expect(await ai.fetchLoveQuote(input)).toBe('有你在，日子就有光。')
    expect(fetchApi).toHaveBeenCalledWith('/api/ai/love-quote', expect.objectContaining({ method: 'POST', retry: 0,
      body: input, headers: { Authorization: 'Bearer supabase-session-token' } }))
    expect(ai.quoteLoading.value).toBe(false); expect(ai.quoteIsFallback.value).toBe(false)
  })
  it.each(['no key', 'network error'] as const)('uses local content after %s and marks diary output honestly', async () => {
    fetchApi.mockRejectedValue(new Error('unavailable'))
    const ai = setup()
    const quote = await ai.fetchLoveQuote(input)
    expect(quote).toBeTruthy(); expect([...quote!].length).toBeLessThanOrEqual(20)
    expect(ai.quoteIsFallback.value).toBe(true)
    const diary = await ai.generateDiary([{ title: '一起散步', body: '看见了晚霞' }])
    expect(diary).toContain('一起散步：看见了晚霞')
    expect(ai.diaryIsFallback.value).toBe(true)
    expect(ai.diaryNotice.value).toContain('本地整理')
    expect(ai.diaryLoading.value).toBe(false)
  })
  it('does not call an endpoint without pairing or with an old account session', async () => {
    profile.value = null
    const ai = setup()
    expect(await ai.fetchLoveQuote(input)).toBeTruthy()
    expect(fetchApi).not.toHaveBeenCalled()
    profile.value = { coupleId: 'couple-a' }
    session.mockResolvedValue({ data: { session: { user: { id: 'different-user' }, access_token: 'stale' } }, error: null })
    expect(await ai.fetchLoveQuote(input)).toBeTruthy()
    expect(fetchApi).not.toHaveBeenCalled()
  })
  it('shows an actionable quota reason while keeping a local fallback', async () => {
    fetchApi.mockRejectedValue({ data: { data: { code: 'AI_BALANCE_INSUFFICIENT' } } })
    const ai = setup()
    await ai.fetchLoveQuote(input)
    expect(ai.quoteIsFallback.value).toBe(true)
    expect(ai.quoteNotice.value).toContain('额度暂时不足')
    await ai.generateDiary([{ title: '一起散步' }])
    expect(ai.diaryNotice.value).toContain('额度暂时不足')
    expect(ai.diaryNotice.value).toContain('本地整理')
  })
  it('bounds a pending session lookup and a pending fetch', async () => {
    vi.useFakeTimers()
    session.mockImplementation(() => new Promise(() => {}))
    const ai = setup()
    const pendingSession = ai.fetchLoveQuote(input)
    await vi.advanceTimersByTimeAsync(5001)
    expect(await pendingSession).toBeTruthy()
    expect(ai.quoteLoading.value).toBe(false)
    session.mockResolvedValue({ data: { session: { user: { id: 'user-a' }, access_token: 'session-token' } }, error: null })
    fetchApi.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    const pendingFetch = ai.fetchLoveQuote(input)
    await flush(); await vi.advanceTimersByTimeAsync(45001)
    expect(await pendingFetch).toBeTruthy(); expect(ai.quoteLoading.value).toBe(false)
  })
  it('ignores an older response and clears private diary state on an account switch', async () => {
    let resolve!: (value: unknown) => void
    fetchApi.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const ai = setup()
    const old = ai.generateDiary([{ title: '旧空间回忆' }])
    await flush()
    user.value = { id: 'user-b' }; profile.value = { coupleId: 'couple-b' }
    resolve({ text: '旧空间日记', source: 'ai' })
    expect(await old).toBeNull()
    expect(ai.diary.value).toBe(''); expect(ai.diaryLoading.value).toBe(false)
  })
  it('supersedes previous requests and releases pending work on scope disposal', async () => {
    const deferred: ((value: unknown) => void)[] = []
    fetchApi.mockImplementation(() => new Promise(resolve => deferred.push(resolve)))
    const ai = setup()
    const first = ai.fetchLoveQuote(input); await flush()
    const second = ai.fetchLoveQuote(input); await flush()
    deferred[1]!({ text: '新的情话', source: 'ai' })
    expect(await second).toBe('新的情话')
    deferred[0]!({ text: '旧的情话', source: 'ai' })
    expect(await first).toBeNull(); expect(ai.loveQuote.value).toBe('新的情话')
    const pending = ai.generateDiary([{ title: '日记' }]); await flush()
    scope.stop()
    deferred[2]!({ text: '卸载后的日记', source: 'ai' })
    expect(await pending).toBeNull(); expect(ai.diary.value).toBe('')
  })
})
