import { computed } from 'vue'
import type { User } from '@supabase/supabase-js'
import { buildPairingInvite, inviteAuthPath } from '../utils/pairingInvite'

export type CoupleStage = 'signed-out' | 'awaiting-confirmation' | 'unpaired' | 'paired' | 'membership-error' | 'initialization-error'
export type OAuthProvider = 'google' | 'github'
export type CoupleProfile = {
  id: string
  displayName: string
  email: string
  coupleId?: string
  role?: 'a' | 'b'
  nameA?: string
  nameB?: string
  startDate?: string
  partnerName?: string
}

type MembershipRow = {
  couple_id: string
  role: string
  couples: { name_a: string | null; name_b: string | null; start_date: string | null } | null
}
type BoundedTask<T> = { promise: Promise<T>; cancel: () => void }
type MembershipTask = BoundedTask<void> & { userId: string; revision: number; controller: AbortController }
type InitializationTask = BoundedTask<void> & { generation: number; hasAuthEvent: boolean }
type AuthRuntime = {
  revision: number
  authEventRevision: number
  authIntent: number
  pendingOperations: number
  initializationGeneration: number
  subscriptionGeneration: number
  initialization?: InitializationTask
  membership?: MembershipTask
  subscription?: { unsubscribe: () => void }
  eventTimer?: ReturnType<typeof setTimeout>
}

// Non-serializable work belongs to one Nuxt app and never enters its SSR payload.
const runtimes = new WeakMap<object, AuthRuntime>()
const AUTH_DEADLINE_MS = 8_000
// A stored, expired session can require the SDK's 30s refresh retry budget
// plus its final network attempt. Membership reads keep the shorter deadline.
const SESSION_DEADLINE_MS = 45_000

class AuthDeadlineError extends Error { override name = 'AuthDeadlineError' }
class AuthCancelledError extends Error { override name = 'AuthCancelledError' }

/** Race the whole SDK operation, including time spent waiting for its auth lock. */
function boundedTask<T>(work: () => T | PromiseLike<T>, message: string, onTimeout?: () => void, deadlineMs = AUTH_DEADLINE_MS): BoundedTask<T> {
  let settled = false
  let timer: ReturnType<typeof setTimeout>
  let cancel = () => {}
  const promise = new Promise<T>((resolve, reject) => {
    const finish = (action: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      action()
    }
    timer = setTimeout(() => finish(() => {
      onTimeout?.()
      reject(new AuthDeadlineError(message))
    }), deadlineMs)
    cancel = () => finish(() => reject(new AuthCancelledError('认证操作已被新的操作替代')))
    // Attach both handlers even when work never honors cancellation or AbortSignal.
    try {
      Promise.resolve(work()).then(
        value => finish(() => resolve(value)),
        error => finish(() => reject(error)),
      )
    } catch (error) {
      finish(() => reject(error))
    }
  })
  return { promise, cancel: () => cancel() }
}

function diagnostic(label: string, fields: Record<string, string | number | boolean> = {}) {
  if (import.meta.dev) console.info('[LoveAuth]', label, fields)
}

function errorKind(error: unknown) {
  return error instanceof AuthDeadlineError ? 'timeout' : error instanceof AuthCancelledError ? 'cancelled' : 'sdk-error'
}

export function useCoupleAuth() {
  const nuxtApp = useNuxtApp()
  const { $supabase } = nuxtApp
  const user = useState<User | null>('couple-auth:user', () => null)
  const profile = useState<CoupleProfile | null>('couple-auth:profile', () => null)
  const stage = useState<CoupleStage>('couple-auth:stage', () => 'signed-out')
  const loading = useState('couple-auth:loading', () => false)
  const initialized = useState('couple-auth:initialized', () => false)
  const demoMode = useState('couple-auth:demo-mode', () => false)
  const authError = useState('couple-auth:error', () => '')
  const initializationError = useState('couple-auth:initialization-error', () => '')
  const membershipLoading = useState('couple-auth:membership-loading', () => false)
  const membershipReady = useState('couple-auth:membership-ready', () => false)
  const configured = computed(() => Boolean($supabase))
  let runtime = runtimes.get(nuxtApp)
  if (!runtime) {
    runtime = { revision: 0, authEventRevision: 0, authIntent: 0, pendingOperations: 0, initializationGeneration: 0, subscriptionGeneration: 0 }
    runtimes.set(nuxtApp, runtime)
  }
  const sessionRuntime = runtime

  function requireClient() {
    if (!$supabase) throw new Error('Supabase 尚未配置，请检查公开环境变量')
    return $supabase
  }

  function errorMessage(error: unknown) {
    return error && typeof error === 'object' && 'message' in error
      ? String(error.message)
      : '操作失败，请稍后重试'
  }

  async function withAction<T>(action: () => Promise<T>): Promise<T> {
    sessionRuntime.pendingOperations++
    loading.value = true
    authError.value = ''
    try {
      return await action()
    } catch (error) {
      authError.value = errorMessage(error)
      throw error
    } finally {
      sessionRuntime.pendingOperations--
      loading.value = sessionRuntime.pendingOperations > 0
    }
  }

  function invalidateMembership() {
    sessionRuntime.revision++
    sessionRuntime.membership?.controller.abort()
    sessionRuntime.membership?.cancel()
    sessionRuntime.membership = undefined
    if (sessionRuntime.eventTimer !== undefined) clearTimeout(sessionRuntime.eventTimer)
    sessionRuntime.eventTimer = undefined
    membershipLoading.value = false
  }

  function applyUser(nextUser: User | null) {
    const changed = user.value?.id !== nextUser?.id
    if (changed || !nextUser) invalidateMembership()
    user.value = nextUser
    if (!nextUser) {
      profile.value = null
      stage.value = 'signed-out'
      membershipReady.value = false
    } else if (changed) {
      profile.value = null
      stage.value = 'signed-out'
      membershipReady.value = false
      membershipLoading.value = true
    }
  }

  async function refreshMembership(): Promise<void> {
    const currentUser = user.value
    if (!currentUser) return
    const client = requireClient()
    const revision = sessionRuntime.revision
    const existing = sessionRuntime.membership
    if (existing?.userId === currentUser.id && existing.revision === revision) return existing.promise
    const controller = new AbortController()
    const task: MembershipTask = { userId: currentUser.id, revision, controller, promise: Promise.resolve(), cancel: () => {} }
    const isCurrent = () => sessionRuntime.membership === task && user.value?.id === currentUser.id && sessionRuntime.revision === revision
    const startedAt = Date.now()
    membershipLoading.value = true
    authError.value = ''
    sessionRuntime.membership = task
    diagnostic('membership:start', { revision })
    task.promise = (async () => {
      try {
        const request = boundedTask(() => client
          .from('couple_members')
          .select('couple_id, role, couples(name_a, name_b, start_date)')
          .eq('user_id', currentUser.id)
          .abortSignal(controller.signal)
          .maybeSingle(), '空间信息读取超时，请检查网络后重试', () => controller.abort())
        task.cancel = request.cancel
        const { data, error } = await request.promise
        if (!isCurrent()) return
        if (error) throw error
        const member = data as MembershipRow | null
        const couple = member?.couples
        profile.value = {
          id: currentUser.id,
          email: currentUser.email || '',
          displayName: profile.value?.displayName || currentUser.user_metadata?.display_name || currentUser.email?.split('@')[0] || '我',
          coupleId: member?.couple_id,
          role: member?.role === 'a' || member?.role === 'b' ? member.role : undefined,
          nameA: couple?.name_a || undefined,
          nameB: couple?.name_b || undefined,
          startDate: couple?.start_date || undefined,
          partnerName: (member?.role === 'a' ? couple?.name_b : couple?.name_a) || undefined,
        }
        membershipReady.value = true
        stage.value = member?.couple_id ? 'paired' : 'unpaired'
        diagnostic('membership:success', { revision, paired: Boolean(member?.couple_id), elapsedMs: Date.now() - startedAt })
      } catch (error) {
        if (!isCurrent()) return
        diagnostic('membership:error', { revision, kind: errorKind(error), elapsedMs: Date.now() - startedAt })
        membershipReady.value = false
        stage.value = 'membership-error'
        authError.value = `无法读取空间信息：${errorMessage(error)}`
        throw error
      } finally {
        if (isCurrent()) {
          membershipLoading.value = false
          sessionRuntime.membership = undefined
        }
      }
    })()
    return task.promise
  }

  function stopSessionListener() {
    sessionRuntime.subscriptionGeneration++
    sessionRuntime.subscription?.unsubscribe()
    sessionRuntime.subscription = undefined
  }

  function cancelInitialization() {
    sessionRuntime.initializationGeneration++
    sessionRuntime.initialization?.cancel()
    sessionRuntime.initialization = undefined
  }

  function subscribeToSession() {
    if (!$supabase || sessionRuntime.subscription) return
    const generation = ++sessionRuntime.subscriptionGeneration
    const { data } = $supabase.auth.onAuthStateChange((event, session) => {
      // Unsubscribing does not stop callbacks that the SDK already dispatched.
      if (generation !== sessionRuntime.subscriptionGeneration) return
      sessionRuntime.authEventRevision++
      applyUser(session?.user || null)
      // A deadline settles our UI, not the SDK's in-flight recovery. A valid
      // event from this still-current subscription may complete that recovery.
      const recovered = Boolean(initializationError.value) && (
        ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && Boolean(session?.user)) ||
        (event === 'SIGNED_OUT' && !session?.user)
      )
      if (recovered) {
        initializationError.value = ''
        authError.value = ''
        initialized.value = true
        invalidateMembership()
        membershipReady.value = false
        membershipLoading.value = Boolean(session?.user)
        stage.value = 'signed-out'
        diagnostic('getSession:recovered', { event, hasSession: Boolean(session?.user), generation })
      }
      diagnostic('session:event', { event, hasUser: Boolean(session?.user), generation })
      // Auth callbacks run under the SDK's auth lock. Start DB work in a later task.
      if (session?.user) {
        if (sessionRuntime.eventTimer !== undefined) clearTimeout(sessionRuntime.eventTimer)
        sessionRuntime.eventTimer = setTimeout(() => {
          sessionRuntime.eventTimer = undefined
          void refreshMembership().catch(() => { /* The pages render the reactive error state. */ })
        }, 0)
      }
      // A later cross-tab event can establish state while the older SDK read is stuck.
      const initialization = sessionRuntime.initialization
      if (initialization && event !== 'INITIAL_SESSION') {
        initialization.hasAuthEvent = true
        initialization.cancel()
      }
    })
    sessionRuntime.subscription = data.subscription
  }

  async function initialize(): Promise<void> {
    if (import.meta.server) return
    if (sessionRuntime.initialization) return sessionRuntime.initialization.promise
    if (initialized.value) {
      if (sessionRuntime.membership) await sessionRuntime.membership.promise.catch(() => {})
      return
    }
    const generation = ++sessionRuntime.initializationGeneration
    const intent = sessionRuntime.authIntent
    const task: InitializationTask = { generation, hasAuthEvent: false, promise: Promise.resolve(), cancel: () => {} }
    const isCurrent = () => sessionRuntime.initialization === task && sessionRuntime.initializationGeneration === generation && sessionRuntime.authIntent === intent
    const startedAt = Date.now()
    let sessionResolved = false
    initializationError.value = ''
    sessionRuntime.initialization = task
    task.promise = (async () => {
      try {
        subscribeToSession()
        const client = requireClient()
        const eventRevision = sessionRuntime.authEventRevision
        diagnostic('getSession:start', { generation })
        const request = boundedTask(() => client.auth.getSession(), '登录状态恢复超时，登录服务响应较慢或当前网络暂时无法连接', undefined, SESSION_DEADLINE_MS)
        task.cancel = request.cancel
        if (task.hasAuthEvent) request.cancel()
        const { data, error } = await request.promise
        if (!isCurrent()) return
        if (error) throw error
        sessionResolved = true
        diagnostic('getSession:success', { generation, hasSession: Boolean(data.session), elapsedMs: Date.now() - startedAt })
        // A newer cross-tab auth event takes precedence over this session snapshot.
        if (sessionRuntime.authEventRevision === eventRevision) applyUser(data.session?.user || null)
        if (user.value) await refreshMembership()
      } catch (error) {
        if (!isCurrent()) return
        if (task.hasAuthEvent && error instanceof AuthCancelledError) {
          diagnostic('getSession:success', { generation, source: 'auth-event', hasSession: Boolean(user.value), elapsedMs: Date.now() - startedAt })
          // Stay outside the SDK callback/lock even when it superseded the read.
          if (user.value) {
            await new Promise<void>(resolve => setTimeout(resolve, 0))
            if (!isCurrent()) return
            if (sessionRuntime.membership) await sessionRuntime.membership.promise.catch(() => {})
            else if (!membershipReady.value && stage.value !== 'membership-error') await refreshMembership().catch(() => {})
          }
        } else if (!sessionResolved) {
          diagnostic('getSession:error', { generation, kind: errorKind(error), elapsedMs: Date.now() - startedAt })
          // Keep this subscription: the SDK may still finish token refresh.
          // Retry, logout and disposal explicitly retire its generation.
          invalidateMembership()
          const detail = errorMessage(error).replace(/[。.!！]+$/, '')
          initializationError.value = `无法恢复登录状态：${detail}。请重新检查登录状态；若持续失败，可清除本机登录状态后重新登录。`
          authError.value = initializationError.value
          stage.value = 'initialization-error'
        }
      } finally {
        if (isCurrent()) {
          initialized.value = true
          sessionRuntime.initialization = undefined
        }
      }
    })()
    return task.promise
  }

  async function retryInitialization(): Promise<void> {
    diagnostic('getSession:retry')
    sessionRuntime.authIntent++
    cancelInitialization()
    stopSessionListener()
    invalidateMembership()
    user.value = null
    profile.value = null
    membershipReady.value = false
    initialized.value = false
    initializationError.value = ''
    authError.value = ''
    stage.value = 'signed-out'
    return initialize()
  }

  async function signIn(email: string, password: string) {
    await initialize()
    if (initializationError.value) throw new Error(initializationError.value)
    return withAction(async () => {
      const intent = ++sessionRuntime.authIntent
      const eventRevision = sessionRuntime.authEventRevision
      const { data, error } = await requireClient().auth.signInWithPassword({ email: email.trim(), password })
      if (error) throw error
      if (!data.session) throw new Error('登录未返回有效会话，请重试')
      assertCurrentAuthResult(data.session.user, intent, eventRevision)
      applyUser(data.session.user)
      await refreshMembership()
    })
  }

  async function signUp(displayName: string, email: string, password: string, invite?: unknown) {
    await initialize()
    if (initializationError.value) throw new Error(initializationError.value)
    return withAction(async () => {
      const intent = ++sessionRuntime.authIntent
      const eventRevision = sessionRuntime.authEventRevision
      if (!displayName.trim()) throw new Error('请输入你的昵称')
      const { data, error } = await requireClient().auth.signUp({
        email: email.trim(), password,
        options: { data: { display_name: displayName.trim() }, emailRedirectTo: buildPairingInvite(window.location.origin, invite) || `${window.location.origin}/` },
      })
      if (error) throw error
      assertCurrentAuthResult(data.session?.user || null, intent, eventRevision)
      if (data.session) {
        applyUser(data.session.user)
        await refreshMembership()
      } else {
        applyUser(null)
        stage.value = 'awaiting-confirmation'
      }
    })
  }

  function assertCurrentAuthResult(nextUser: User | null, intent: number, eventRevision: number) {
    if (sessionRuntime.authIntent !== intent || (
      sessionRuntime.authEventRevision !== eventRevision && user.value?.id !== nextUser?.id
    )) throw new Error('登录会话已变化，请重新操作')
  }

  async function resendConfirmation(email: string, invite?: unknown) {
    return withAction(async () => {
      const { error } = await requireClient().auth.resend({
        type: 'signup', email: email.trim(), options: { emailRedirectTo: buildPairingInvite(window.location.origin, invite) || `${window.location.origin}/` },
      })
      if (error) throw error
    })
  }

  async function requireUnpairedUser() {
    await initialize()
    if (initializationError.value) throw new Error(initializationError.value)
    if (!user.value) throw new Error('请先登录')
    if (!membershipReady.value) await refreshMembership()
    if (stage.value === 'paired') throw new Error('你已经加入了一个情侣空间')
  }

  async function refreshAfterPairing(userId: string) {
    if (user.value?.id !== userId) throw new Error('登录会话已变化，请重新操作')
    // A lookup started before the write must not hide the membership just created.
    invalidateMembership()
    membershipReady.value = false
    await refreshMembership()
  }

  async function createSpace(nameA: string, nameB: string, startDate: string): Promise<string> {
    return withAction(async () => {
      await requireUnpairedUser()
      const userId = user.value!.id
      if (![nameA, nameB].every(name => name.trim().length >= 1 && name.trim().length <= 40)) throw new Error('双方昵称需要 1-40 个字符')
      const parsedDate = new Date(`${startDate}T00:00:00Z`)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== startDate) throw new Error('请选择有效的在一起日期')
      const { data, error } = await requireClient().rpc('create_couple', {
        p_name_a: nameA.trim(), p_name_b: nameB.trim(), p_start_date: startDate,
      })
      if (error) throw error
      if (!data) throw new Error('创建空间未返回 ID，请刷新空间信息后重试')
      await refreshAfterPairing(userId)
      return data
    })
  }

  async function joinSpace(id: string): Promise<string> {
    return withAction(async () => {
      await requireUnpairedUser()
      const userId = user.value!.id
      const coupleId = id.trim()
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(coupleId)) throw new Error('请输入完整有效的空间 ID')
      const { data, error } = await requireClient().rpc('join_couple', { p_couple_id: coupleId })
      if (error) throw error
      if (!data) throw new Error('加入空间未返回 ID，请刷新空间信息后重试')
      await refreshAfterPairing(userId)
      return data
    })
  }

  async function signOut() {
    return withAction(async () => {
      const intent = ++sessionRuntime.authIntent
      cancelInitialization()
      stopSessionListener()
      invalidateMembership()
      try {
        const { error } = await requireClient().auth.signOut()
        if (sessionRuntime.authIntent !== intent) throw new Error('登录会话已变化，请重新操作')
        if (error) throw error
        applyUser(null)
        initializationError.value = ''
        initialized.value = true
        demoMode.value = false
      } finally {
        // A network failure must not silently disconnect an otherwise valid session.
        if (sessionRuntime.authIntent === intent && !initializationError.value) subscribeToSession()
      }
    })
  }

  // Existing components keep their account, OAuth and invitation APIs.
  const accountEmail = (username: string) => `account.${username.trim().toLowerCase()}@users.love-home.invalid`
  async function signInWithAccount(username: string, password: string) { return signIn(accountEmail(username), password) }
  async function accountRequest(body: Record<string, string>) {
    const { data, error } = await requireClient().functions.invoke('account-auth', { body })
    if (error) {
      let detail = ''
      try { detail = (await (error as { context?: Response }).context?.clone().json())?.error || '' } catch {}
      throw new Error(detail || error.message)
    }
    if (data?.error) throw new Error(data.error)
    return data
  }
  async function signUpWithAccount(displayName: string, username: string, password: string) {
    return withAction(() => accountRequest({ action: 'register', displayName, username, password }))
  }
  async function recoverAccount(username: string, recoveryCode: string, newPassword: string) {
    return withAction(() => accountRequest({ action: 'recover', username, recoveryCode, newPassword }))
  }
  async function signInWithOAuth(provider: OAuthProvider) {
    return withAction(async () => {
      const { error } = await requireClient().auth.signInWithOAuth({ provider, options: { redirectTo: `${window.location.origin}/` } })
      if (error) throw error
    })
  }
  async function updatePassword(password: string) {
    return withAction(async () => {
      if (password.length < 8) throw new Error('新密码至少需要 8 位')
      const { error } = await requireClient().auth.updateUser({ password })
      if (error) throw error
    })
  }
  async function createCouple(displayName: string, relationshipStart: string) {
    return withAction(async () => {
      await requireUnpairedUser()
      const userId = user.value!.id
      const { data, error } = await requireClient().rpc('create_couple_with_invitation', { couple_name: displayName, relationship_start: relationshipStart })
      if (error) throw error
      await refreshAfterPairing(userId)
      return data
    })
  }
  async function joinCouple(code: string) {
    return withAction(async () => {
      await requireUnpairedUser()
      const userId = user.value!.id
      const { error } = await requireClient().rpc('accept_couple_invitation', { invitation_code: code.trim().toUpperCase() })
      if (error) throw error
      await refreshAfterPairing(userId)
    })
  }

  function authRedirect(path: string, invite?: unknown): string | null {
    if (initializationError.value || stage.value === 'initialization-error') return path === '/login' ? null : inviteAuthPath('/login', invite)
    if (!user.value) return path === '/login' ? null : inviteAuthPath('/login', invite)
    if (stage.value !== 'paired') return path === '/pairing' ? null : inviteAuthPath('/pairing', invite)
    // 已配对用户也能打开邀请管理页；登录收到的邀请后在该页说明当前状态。
    if (path !== '/login') return null
    return invite === undefined ? '/' : inviteAuthPath('/pairing', invite)
  }

  function disposeSession() {
    sessionRuntime.authIntent++
    cancelInitialization()
    invalidateMembership()
    stopSessionListener()
    initialized.value = false
  }

  return {
    configured, demoMode, user, initialized, loading, profile, stage, authError, initializationError, membershipLoading, membershipReady,
    initialize, retryInitialization, refreshMembership, signIn, signUp, resendConfirmation, signOut, createSpace, joinSpace,
    signInWithAccount, signUpWithAccount, signInWithOAuth, recoverAccount, updatePassword, createCouple, joinCouple,
    authRedirect, disposeSession,
  }
}
