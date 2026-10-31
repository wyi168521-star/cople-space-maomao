import { afterEach, describe, expect, it, vi } from 'vitest'

const { createClient } = vi.hoisted(() => ({
  createClient: vi.fn((url: string, key: string, options: unknown) => ({ url, key, options })),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient }))
import { createSupabaseClient } from '../app/lib/supabase'

afterEach(() => { createClient.mockClear(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Supabase client factory', () => {
  it('returns null without credentials and creates independent app instances', () => {
    expect(createSupabaseClient({ url: '', anonKey: '', isClient: false })).toBeNull()
    expect(createClient).not.toHaveBeenCalled()
    const config = { url: 'https://example.supabase.co', anonKey: 'public-test-key', isClient: false }
    expect(createSupabaseClient(config)).not.toBe(createSupabaseClient(config))
    expect(createClient).toHaveBeenCalledTimes(2)
    expect(createClient.mock.calls[0]?.[2]).toMatchObject({ auth: {
      persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
    } })
  })

  it('preserves the fetch header normalization and browser auth options', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    createSupabaseClient({ url: 'https://example.supabase.co', anonKey: 'public-test-key', isClient: true })
    const options = createClient.mock.calls[0]?.[2] as { global: { fetch: typeof fetch }; auth: unknown }
    expect(options.auth).toMatchObject({ persistSession: true, autoRefreshToken: true, detectSessionInUrl: true })
    await options.global.fetch('https://example.supabase.co', { headers: { 'x-name': '你好' } })
    expect(fetchMock).toHaveBeenCalledWith('https://example.supabase.co', expect.objectContaining({ headers: { 'x-name': encodeURIComponent('你好') }, signal: expect.any(AbortSignal) }))
  })

  it.each(['caller', 'deadline'] as const)('cancels a waiting network request when its %s aborts', async (source) => {
    const caller = new AbortController()
    const deadline = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)
    createSupabaseClient({ url: 'https://example.supabase.co', anonKey: 'public-test-key', isClient: true })
    const options = createClient.mock.calls[0]?.[2] as { global: { fetch: typeof fetch } }
    const request = options.global.fetch('https://example.supabase.co/auth/v1/token', { signal: caller.signal })
    const name = source === 'caller' ? 'AbortError' : 'TimeoutError'
    const rejected = expect(request).rejects.toMatchObject({ name })
    ;(source === 'caller' ? caller : deadline).abort(new DOMException('cancelled', name))
    await rejected
    expect(AbortSignal.timeout).toHaveBeenCalledWith(10_000)
  })
})
