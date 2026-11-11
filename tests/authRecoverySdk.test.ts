import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref, type Ref } from 'vue'
import { createSupabaseClient, type AppSupabaseClient } from '../app/lib/supabase'
import { useCoupleAuth } from '../app/composables/useCoupleAuth'

const project = 'https://recovery-regression.supabase.co'
const storageKey = 'sb-recovery-regression-auth-token'
const user = { id: '10000000-0000-0000-0000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'test@example.test', user_metadata: {}, app_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
const coupleId = '20000000-0000-0000-0000-000000000002'
let client: AppSupabaseClient | null = null
let auth: ReturnType<typeof useCoupleAuth> | undefined

function session(expired: boolean) {
  const exp = Math.floor(Date.now() / 1000) + (expired ? -3600 : 3600)
  const jwt = [btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), btoa(JSON.stringify({ sub: user.id, exp, aud: 'authenticated', role: 'authenticated' })), 'fake-signature'].join('.')
  return { user, access_token: jwt, refresh_token: 'fake-refresh-only', expires_at: exp, expires_in: 3600, token_type: 'bearer' }
}

async function flush() { for (let n = 0; n < 60; n++) await Promise.resolve() }

function setup(delayMs: number, failFirst = false) {
  vi.useFakeTimers()
  localStorage.setItem(storageKey, JSON.stringify(session(true)))
  let refreshes = 0
  const request = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    expect(url.origin).toBe(window.location.origin)
    if (url.pathname.endsWith('/auth/v1/token')) {
      refreshes++
      if (failFirst && refreshes === 1) throw new TypeError('Simulated offline connection')
      await new Promise(resolve => setTimeout(resolve, delayMs))
      return new Response(JSON.stringify(session(false)), { headers: { 'content-type': 'application/json' } })
    }
    expect(url.pathname).toBe('/api/supabase/rest/v1/couple_members')
    return new Response(JSON.stringify({ couple_id: coupleId, role: 'a', couples: { name_a: 'A', name_b: 'B', start_date: '2024-05-20' } }), { headers: { 'content-type': 'application/json' } })
  })
  vi.stubGlobal('fetch', request)
  client = createSupabaseClient({ url: project, anonKey: 'test-publishable-only', isClient: true })
  const app = { $supabase: client }
  const states = new Map<string, Ref>()
  vi.stubGlobal('useNuxtApp', () => app)
  vi.stubGlobal('useState', (key: string, init: () => unknown) => {
    if (!states.has(key)) states.set(key, ref(init()))
    return states.get(key)
  })
  auth = useCoupleAuth()
  return { auth, request }
}

afterEach(async () => {
  auth?.disposeSession(); auth = undefined
  await client?.auth.dispose(); client = null
  for (const suffix of ['', '-user', '-code-verifier']) localStorage.removeItem(storageKey + suffix)
  vi.useRealTimers(); vi.unstubAllGlobals()
})

describe('expired-session recovery with the real Supabase SDK', () => {
  it('recovers a refresh slower than eight seconds through the relay without blocking login permanently', async () => {
    const { auth, request } = setup(9000)
    const initializing = auth.initialize()
    await flush()
    await vi.advanceTimersByTimeAsync(8001)
    expect(auth.initialized.value).toBe(false)
    expect(auth.initializationError.value).toBe('')
    await vi.advanceTimersByTimeAsync(1100)
    await initializing
    expect(auth.stage.value).toBe('paired')
    expect(auth.profile.value?.coupleId).toBe(coupleId)
    expect(request.mock.calls.filter(([input]) => String(input).includes('/auth/v1/token'))).toHaveLength(1)
    expect(JSON.parse(localStorage.getItem(storageKey)!).expires_at).toBeGreaterThan(Date.now() / 1000)
  })

  it('allows the SDK refresh retry to complete and preserves the original project session key', async () => {
    const { auth, request } = setup(100, true)
    const initializing = auth.initialize()
    await flush()
    await vi.advanceTimersByTimeAsync(1000)
    await initializing
    expect(auth.stage.value).toBe('paired')
    expect(auth.initializationError.value).toBe('')
    expect(request.mock.calls.filter(([input]) => String(input).includes('/auth/v1/token'))).toHaveLength(2)
    expect(localStorage.getItem(storageKey)).toBeTruthy()
    expect(localStorage.getItem('sb-localhost-auth-token')).toBeNull()
  })
})
