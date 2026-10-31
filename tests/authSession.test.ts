import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref, type Ref } from 'vue'
import type { User } from '@supabase/supabase-js'
import { useCoupleAuth } from '../app/composables/useCoupleAuth'
import { useAuth } from '../app/composables/useAuth'

const coupleId = '10000000-0000-0000-0000-000000000001'
const accountA = { id: 'account-a', email: 'a@example.com', user_metadata: { display_name: '小林' } } as User
const accountB = { id: 'account-b', email: 'b@example.com', user_metadata: { display_name: '小许' } } as User
const paired = (role: 'a' | 'b' = 'a') => ({
  data: { couple_id: coupleId, role, couples: { name_a: '小林', name_b: '小许', start_date: '2024-05-20' } }, error: null,
})
const unpaired = () => ({ data: null, error: null })
const auths: ReturnType<typeof useAuth>[] = []

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

async function flushMicrotasks() {
  for (let count = 0; count < 12; count++) await Promise.resolve()
}

function fixture(initialUser: User | null = null) {
  vi.useFakeTimers()
  const states = new Map<string, Ref>()
  const read = vi.fn().mockResolvedValue(unpaired())
  const signals: AbortSignal[] = []
  const callbacks: Array<(event: string, session: { user: User } | null) => unknown> = []
  let onAuthEvent!: (event: string, session: { user: User } | null) => unknown
  const client = {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: initialUser ? { user: initialUser } : null }, error: null }),
      onAuthStateChange: vi.fn(callback => {
        onAuthEvent = callback
        callbacks.push(callback)
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      }),
      signInWithPassword: vi.fn(), signUp: vi.fn(),
      resend: vi.fn().mockResolvedValue({ error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ abortSignal: (signal: AbortSignal) => {
        signals.push(signal)
        return { maybeSingle: read }
      } }) }),
    })),
    rpc: vi.fn().mockResolvedValue({ data: coupleId, error: null }),
  }
  const app = { $supabase: client }
  vi.stubGlobal('useNuxtApp', () => app)
  vi.stubGlobal('useState', (key: string, init: () => unknown) => {
    if (!states.has(key)) states.set(key, ref(init()))
    return states.get(key)
  })
  const auth = useAuth()
  auths.push(auth)
  return {
    auth, client, read, signals,
    emit: (event: string, nextUser: User | null) => onAuthEvent(event, nextUser ? { user: nextUser } : null),
    emitFrom: (index: number, event: string, nextUser: User | null) => callbacks[index]?.(event, nextUser ? { user: nextUser } : null),
  }
}

afterEach(() => {
  for (const auth of auths.splice(0)) auth.disposeSession()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('shared auth session', () => {
  it('settles a locked SDK session read at its deadline and exposes a retryable initialization error', async () => {
    const { auth, client, emitFrom } = fixture()
    client.auth.getSession.mockReturnValue(new Promise(() => {}))
    const initializing = auth.initialize()
    await vi.advanceTimersByTimeAsync(7_999)
    expect(auth.initialized.value).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await initializing
    expect(auth.initialized.value).toBe(true)
    expect(auth.initializationError.value).toContain('登录状态恢复超时')
    expect(auth.stage.value).toBe('initialization-error')
    expect(auth.authRedirect('/pairing')).toBe('/login')
    emitFrom(0, 'SIGNED_IN', accountA)
    await vi.advanceTimersByTimeAsync(0)
    expect(auth.user.value).toBeNull()
    await expect(auth.signIn('a@example.com', 'correct-password')).rejects.toThrow('重新检查登录状态')
    expect(client.auth.signInWithPassword).not.toHaveBeenCalled()
  })

  it('retries immediately while an older SDK read never settles and ignores its late snapshot and callbacks', async () => {
    const { auth, client, read, emitFrom } = fixture()
    const firstRead = deferred<{ data: { session: { user: User } | null }; error: null }>()
    const secondRead = deferred<{ data: { session: { user: User } | null }; error: null }>()
    client.auth.getSession.mockReturnValueOnce(firstRead.promise).mockReturnValueOnce(secondRead.promise)
    const firstInitializing = auth.initialize()
    const retrying = auth.retryInitialization()
    const concurrentCaller = auth.initialize()
    await firstInitializing
    expect(client.auth.getSession).toHaveBeenCalledTimes(2)
    expect(auth.initialized.value).toBe(false)
    read.mockResolvedValue(paired('b'))
    secondRead.resolve({ data: { session: { user: accountB } }, error: null })
    await Promise.all([retrying, concurrentCaller])
    expect(auth.user.value?.id).toBe(accountB.id)
    expect(auth.initializationError.value).toBe('')
    firstRead.resolve({ data: { session: { user: accountA } }, error: null })
    emitFrom(0, 'INITIAL_SESSION', accountA)
    emitFrom(0, 'SIGNED_OUT', null)
    await flushMicrotasks()
    expect(auth.user.value?.id).toBe(accountB.id)
    expect(auth.stage.value).toBe('paired')
    expect(auth.profile.value?.role).toBe('b')
  })

  it('allows a bounded successful retry after a timed-out session read', async () => {
    const { auth, client } = fixture()
    client.auth.getSession.mockReturnValueOnce(new Promise(() => {}))
    const first = auth.initialize()
    await vi.advanceTimersByTimeAsync(8_000)
    await first
    expect(auth.initializationError.value).not.toBe('')
    await auth.retryInitialization()
    expect(client.auth.getSession).toHaveBeenCalledTimes(2)
    expect(auth.initialized.value).toBe(true)
    expect(auth.initializationError.value).toBe('')
    expect(auth.stage.value).toBe('signed-out')
  })

  it('aborts and bounds membership reads even when the query ignores AbortSignal', async () => {
    const { auth, read, signals } = fixture(accountA)
    const staleRead = deferred<ReturnType<typeof unpaired>>()
    read.mockReturnValueOnce(staleRead.promise)
    const initializing = auth.initialize()
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(8_000)
    await initializing
    expect(signals[0]?.aborted).toBe(true)
    expect(auth.initialized.value).toBe(true)
    expect(auth.initializationError.value).toBe('')
    expect(auth.stage.value).toBe('membership-error')
    expect(auth.authError.value).toContain('空间信息读取超时')
    expect(auth.membershipLoading.value).toBe(false)
    read.mockResolvedValueOnce(paired())
    await auth.refreshMembership()
    staleRead.resolve(unpaired())
    await flushMicrotasks()
    expect(auth.profile.value?.coupleId).toBe(coupleId)
    expect(auth.stage.value).toBe('paired')
  })

  it('keeps a newer same-user query pending when a timed-out read resolves late', async () => {
    const { auth, read } = fixture(accountA)
    await auth.initialize()
    const oldRead = deferred<ReturnType<typeof unpaired>>()
    const newRead = deferred<ReturnType<typeof paired>>()
    read.mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(newRead.promise)
    const oldRefreshing = auth.refreshMembership()
    const rejected = expect(oldRefreshing).rejects.toThrow('空间信息读取超时')
    await vi.advanceTimersByTimeAsync(8_000)
    await rejected
    const newRefreshing = auth.refreshMembership()
    oldRead.resolve(unpaired())
    await flushMicrotasks()
    expect(auth.membershipLoading.value).toBe(true)
    expect(auth.membershipReady.value).toBe(false)
    newRead.resolve(paired())
    await newRefreshing
    expect(auth.stage.value).toBe('paired')
    expect(auth.membershipLoading.value).toBe(false)
  })

  it.each(['SIGNED_IN', 'SIGNED_OUT'] as const)('lets a newer %s event supersede a stuck initial read', async (event) => {
    const { auth, client, read, emit } = fixture()
    const staleSession = deferred<{ data: { session: null }; error: null }>()
    client.auth.getSession.mockReturnValueOnce(staleSession.promise)
    read.mockResolvedValue(paired('b'))
    const initializing = auth.initialize()
    emit(event, event === 'SIGNED_IN' ? accountB : null)
    await vi.advanceTimersByTimeAsync(0)
    await initializing
    expect(auth.initialized.value).toBe(true)
    expect(auth.initializationError.value).toBe('')
    expect(auth.stage.value).toBe(event === 'SIGNED_IN' ? 'paired' : 'signed-out')
    await vi.advanceTimersByTimeAsync(8_000)
    staleSession.resolve({ data: { session: null }, error: null })
    await flushMicrotasks()
    expect(auth.initializationError.value).toBe('')
    expect(auth.user.value?.id || null).toBe(event === 'SIGNED_IN' ? accountB.id : null)
  })

  it('deduplicates concurrent initialization and keeps Nuxt app instances separate', async () => {
    const first = fixture(accountA)
    const otherCaller = useCoupleAuth()
    await Promise.all([first.auth.initialize(), first.auth.initialize(), otherCaller.initialize()])
    expect(first.client.auth.getSession).toHaveBeenCalledTimes(1)
    expect(first.client.auth.onAuthStateChange).toHaveBeenCalledTimes(1)
    expect(first.client.from).toHaveBeenCalledTimes(1)
    expect(otherCaller.user).toBe(first.auth.user)
    expect(first.auth.stage.value).toBe('unpaired')
    const second = fixture()
    await second.auth.initialize()
    expect(second.auth.user.value).toBeNull()
    expect(first.auth.user.value?.id).toBe(accountA.id)
  })

  it('defers DB work outside the auth callback and preserves a known same-user profile', async () => {
    const { auth, client, read, emit } = fixture()
    await auth.initialize()
    read.mockResolvedValue(paired())
    expect(emit('SIGNED_IN', accountA)).toBeUndefined()
    expect(client.from).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(0)
    expect(auth.stage.value).toBe('paired')
    expect(auth.profile.value?.coupleId).toBe(coupleId)
    emit('TOKEN_REFRESHED', accountA)
    expect(auth.stage.value).toBe('paired')
    expect(auth.profile.value?.coupleId).toBe(coupleId)
  })

  it('reports membership errors separately from an unpaired account and supports retry', async () => {
    const { auth, read } = fixture(accountA)
    read.mockResolvedValueOnce({ data: null, error: { message: 'permission denied' } })
    await auth.initialize()
    expect(auth.initialized.value).toBe(true)
    expect(auth.stage.value).toBe('membership-error')
    expect(auth.membershipReady.value).toBe(false)
    expect(auth.authError.value).toContain('permission denied')
    expect(auth.authRedirect('/')).toBe('/pairing')
    await auth.refreshMembership()
    expect(auth.stage.value).toBe('unpaired')
    expect(auth.membershipReady.value).toBe(true)
    expect(auth.authError.value).toBe('')
  })

  it('awaits sign-in membership and supports a no-session confirmation signup', async () => {
    const { auth, client, read, emit } = fixture()
    await auth.initialize()
    const membership = deferred<ReturnType<typeof unpaired>>()
    read.mockReturnValueOnce(membership.promise)
    client.auth.signInWithPassword.mockImplementation(async () => {
      emit('SIGNED_IN', accountA)
      return { data: { session: { user: accountA } }, error: null }
    })
    const signingIn = auth.signIn(' a@example.com ', 'correct-password')
    await flushMicrotasks()
    expect(auth.loading.value).toBe(true)
    expect(auth.membershipLoading.value).toBe(true)
    membership.resolve(unpaired())
    await signingIn
    expect(auth.stage.value).toBe('unpaired')
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'a@example.com', password: 'correct-password' })
    await auth.signOut()
    client.auth.signUp.mockResolvedValue({ data: { user: accountB, session: null }, error: null })
    await auth.signUp('小许', ' b@example.com ', 'correct-password')
    expect(auth.user.value).toBeNull()
    expect(auth.stage.value).toBe('awaiting-confirmation')
    expect(auth.authRedirect('/login')).toBeNull()
    await auth.resendConfirmation(' b@example.com ')
    expect(client.auth.resend).toHaveBeenCalledWith(expect.objectContaining({ type: 'signup', email: 'b@example.com' }))
  })

  it('does not resurrect a returned sign-in session after a newer signed-out event', async () => {
    const { auth, client, emit } = fixture()
    await auth.initialize()
    const response = deferred<{ data: { session: { user: User } }; error: null }>()
    client.auth.signInWithPassword.mockReturnValue(response.promise)
    const signingIn = auth.signIn('a@example.com', 'correct-password')
    const rejected = expect(signingIn).rejects.toThrow('登录会话已变化')
    await flushMicrotasks()
    emit('SIGNED_OUT', null)
    response.resolve({ data: { session: { user: accountA } }, error: null })
    await rejected
    expect(auth.user.value).toBeNull()
    expect(auth.stage.value).toBe('signed-out')
  })

  it.each(['create', 'join'] as const)('calls the typed %s RPC and reloads its persisted membership', async (action) => {
    const { auth, client, read } = fixture(action === 'create' ? accountA : accountB)
    await auth.initialize()
    read.mockResolvedValue(paired(action === 'create' ? 'a' : 'b'))
    const result = action === 'create'
      ? await auth.createSpace(' 小林 ', ' 小许 ', '2024-05-20')
      : await auth.joinSpace(` ${coupleId} `)
    expect(result).toBe(coupleId)
    expect(client.rpc).toHaveBeenCalledWith(action === 'create' ? 'create_couple' : 'join_couple', action === 'create'
      ? { p_name_a: '小林', p_name_b: '小许', p_start_date: '2024-05-20' }
      : { p_couple_id: coupleId })
    expect(auth.stage.value).toBe('paired')
    expect(auth.profile.value).toMatchObject({ coupleId, nameA: '小林', nameB: '小许', startDate: '2024-05-20' })
    expect(auth.authRedirect('/pairing')).toBe('/')
  })

  it('aborts pre-write membership reads before refreshing a successful pairing', async () => {
    const { auth, client, read, signals, emit } = fixture(accountA)
    await auth.initialize()
    const rpcResponse = deferred<{ data: string; error: null }>()
    const staleRead = deferred<ReturnType<typeof unpaired>>()
    client.rpc.mockReturnValueOnce(rpcResponse.promise)
    read.mockReturnValueOnce(staleRead.promise).mockResolvedValueOnce(paired())
    const creating = auth.createSpace('小林', '小许', '2024-05-20')
    await flushMicrotasks()
    emit('SIGNED_IN', accountA)
    await vi.advanceTimersByTimeAsync(0)
    expect(client.from).toHaveBeenCalledTimes(2)
    rpcResponse.resolve({ data: coupleId, error: null })
    await creating
    expect(signals[1]?.aborted).toBe(true)
    staleRead.resolve(unpaired())
    await flushMicrotasks()
    expect(auth.stage.value).toBe('paired')
    expect(auth.profile.value?.coupleId).toBe(coupleId)
  })

  it('cancels a pending query on logout and ignores its late response', async () => {
    const { auth, read, signals } = fixture(accountA)
    await auth.initialize()
    const oldRead = deferred<ReturnType<typeof paired>>()
    read.mockReturnValueOnce(oldRead.promise)
    const refreshing = auth.refreshMembership()
    await auth.signOut()
    expect(signals[1]?.aborted).toBe(true)
    oldRead.resolve(paired())
    await refreshing
    expect(auth.user.value).toBeNull()
    expect(auth.profile.value).toBeNull()
    expect(auth.stage.value).toBe('signed-out')
    expect(auth.authRedirect('/')).toBe('/login')
  })

  it('restores session events after a failed logout', async () => {
    const { auth, client, emit } = fixture(accountA)
    await auth.initialize()
    client.auth.signOut.mockResolvedValueOnce({ error: new Error('network failed') })
    await expect(auth.signOut()).rejects.toThrow('network failed')
    expect(auth.user.value?.id).toBe(accountA.id)
    expect(client.auth.onAuthStateChange).toHaveBeenCalledTimes(2)
    emit('SIGNED_OUT', null)
    expect(auth.user.value).toBeNull()
    expect(auth.stage.value).toBe('signed-out')
  })

  it('does not let an older logout erase a newer successful initialization retry', async () => {
    const { auth, client, read } = fixture(accountA)
    await auth.initialize()
    const logoutResponse = deferred<{ error: null }>()
    client.auth.signOut.mockReturnValueOnce(logoutResponse.promise)
    const signingOut = auth.signOut()
    const rejected = expect(signingOut).rejects.toThrow('登录会话已变化')
    client.auth.getSession.mockResolvedValueOnce({ data: { session: { user: accountB } }, error: null })
    read.mockResolvedValueOnce(paired('b'))
    await auth.retryInitialization()
    logoutResponse.resolve({ error: null })
    await rejected
    expect(auth.user.value?.id).toBe(accountB.id)
    expect(auth.stage.value).toBe('paired')
    expect(client.auth.onAuthStateChange).toHaveBeenCalledTimes(2)
  })

  it('does not let an old-account query clear a newer-account pending query', async () => {
    const { auth, read, emit } = fixture(accountA)
    await auth.initialize()
    const oldRead = deferred<ReturnType<typeof paired>>()
    const newRead = deferred<ReturnType<typeof paired>>()
    read.mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(newRead.promise)
    const oldRefreshing = auth.refreshMembership()
    emit('SIGNED_IN', accountB)
    await vi.advanceTimersByTimeAsync(0)
    oldRead.resolve(paired())
    await oldRefreshing
    expect(auth.user.value?.id).toBe(accountB.id)
    expect(auth.membershipLoading.value).toBe(true)
    expect(auth.profile.value).toBeNull()
    newRead.resolve(paired('b'))
    await flushMicrotasks()
    expect(auth.profile.value?.role).toBe('b')
    expect(auth.profile.value?.id).toBe(accountB.id)
    expect(auth.membershipLoading.value).toBe(false)
  })
})
