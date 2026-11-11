import { afterEach, describe, expect, it, vi } from 'vitest'

const { createClient } = vi.hoisted(() => ({
  createClient: vi.fn((url: string, key: string, options: unknown) => ({ url, key, options })),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient }))
import { clearSupabaseLocalSession, createSupabaseClient } from '../app/lib/supabase'

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
    createSupabaseClient({ url: 'https://example.supabase.co', anonKey: 'public-test-key', isClient: false })
    const options = createClient.mock.calls[0]?.[2] as { global: { fetch: typeof fetch } }
    const request = options.global.fetch('https://example.supabase.co/auth/v1/token', { signal: caller.signal })
    const name = source === 'caller' ? 'AbortError' : 'TimeoutError'
    const rejected = expect(request).rejects.toMatchObject({ name })
    ;(source === 'caller' ? caller : deadline).abort(new DOMException('cancelled', name))
    await rejected
    expect(AbortSignal.timeout).toHaveBeenCalledWith(10_000)
  })

  it('relays cloud auth and REST through this origin while preserving credentials, queries and request bodies', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    createSupabaseClient({ url: 'https://example.supabase.co', anonKey: 'public-test-key', isClient: true })
    const options = createClient.mock.calls[0]?.[2] as { global: { fetch: typeof fetch } }
    await options.global.fetch('https://example.supabase.co/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', headers: { Authorization: 'Bearer test-user-token' }, body: '{"refresh_token":"fake-refresh"}',
    })
    expect(fetchMock).toHaveBeenLastCalledWith(`${window.location.origin}/api/supabase/auth/v1/token?grant_type=refresh_token`, expect.objectContaining({
      method: 'POST', headers: { Authorization: 'Bearer test-user-token' }, body: '{"refresh_token":"fake-refresh"}', credentials: 'omit',
    }))
    const request = new Request('https://example.supabase.co/rest/v1/rpc/join_couple', {
      method: 'POST', headers: { Authorization: 'Bearer fake-user', 'Content-Type': 'application/json' }, body: '{"p_couple_id":"fake-id"}',
    })
    await options.global.fetch(request)
    const forwarded = fetchMock.mock.calls.at(-1)![0] as unknown as Request
    expect(forwarded.url).toBe(`${window.location.origin}/api/supabase/rest/v1/rpc/join_couple`)
    expect(forwarded.method).toBe('POST')
    expect(forwarded.headers.get('authorization')).toBe('Bearer fake-user')
    expect(await forwarded.text()).toBe('{"p_couple_id":"fake-id"}')
  })

  it('does not relay local development, storage uploads, unrelated origins or server-side requests', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    for (const [url, isClient, address] of [
      ['http://127.0.0.1:54321', true, 'http://127.0.0.1:54321/auth/v1/user'],
      ['https://example.supabase.co', true, 'https://example.supabase.co/storage/v1/object/couple-media/photo.jpg'],
      ['https://example.supabase.co', true, 'https://other.supabase.co/auth/v1/user'],
      ['https://example.supabase.co', false, 'https://example.supabase.co/auth/v1/user'],
    ] as const) {
      createSupabaseClient({ url, anonKey: 'public-test-key', isClient })
      const options = createClient.mock.calls.at(-1)?.[2] as { global: { fetch: typeof fetch } }
      await options.global.fetch(address)
      expect(fetchMock).toHaveBeenLastCalledWith(address, expect.any(Object))
    }
  })

  it('clears only this project authentication keys when explicitly requested', () => {
    localStorage.setItem('sb-example-auth-token', 'old-session')
    localStorage.setItem('sb-example-auth-token-user', 'old-user')
    localStorage.setItem('sb-example-auth-token-code-verifier', 'old-pkce')
    localStorage.setItem('sb-other-auth-token', 'keep-other-project')
    localStorage.setItem('love-preferences', 'keep-preferences')
    clearSupabaseLocalSession('https://example.supabase.co')
    expect(localStorage.getItem('sb-example-auth-token')).toBeNull()
    expect(localStorage.getItem('sb-example-auth-token-user')).toBeNull()
    expect(localStorage.getItem('sb-example-auth-token-code-verifier')).toBeNull()
    expect(localStorage.getItem('sb-other-auth-token')).toBe('keep-other-project')
    expect(localStorage.getItem('love-preferences')).toBe('keep-preferences')
    localStorage.removeItem('sb-other-auth-token')
    localStorage.removeItem('love-preferences')
  })
})
