import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { Capacitor } from '@capacitor/core'
import type { Database } from '../types/database.generated'

export type AppSupabaseClient = SupabaseClient<Database> & { resumableUploadUrl: string }

export type SupabaseClientConfig = {
  url: string
  anonKey: string
  isClient: boolean
}

const SESSION_STORAGE_ERROR = '此浏览器无法保存登录状态，请允许本站使用本地存储，并检查浏览器的数据清理设置后重试。'

/** 不保存密码，也不管理令牌；会话的读写和刷新仍完全交给 Supabase SDK。 */
function browserSessionStorage() {
  return {
    getItem(key: string) {
      try { return window.localStorage.getItem(key) }
      catch { throw new Error(SESSION_STORAGE_ERROR) }
    },
    setItem(key: string, value: string) {
      try { window.localStorage.setItem(key, value) }
      catch { throw new Error(SESSION_STORAGE_ERROR) }
    },
    removeItem(key: string) {
      try { window.localStorage.removeItem(key) }
      catch { throw new Error(SESSION_STORAGE_ERROR) }
    },
  }
}

/** SDK 的默认策略可能退回内存存储；这里让不可持久化成为可见、可重试的错误。 */
export function assertSupabaseSessionStorage(): void {
  if (typeof window === 'undefined') return
  // 只是无敏感内容的探测键，不依赖仅在安全上下文可用的 crypto.randomUUID。
  const key = `love-auth-storage-check-${Date.now()}-${Math.random().toString(36).slice(2)}`
  try {
    const storage = browserSessionStorage()
    storage.setItem(key, '1')
    if (storage.getItem(key) !== '1') throw new Error(SESSION_STORAGE_ERROR)
    storage.removeItem(key)
  } catch { throw new Error(SESSION_STORAGE_ERROR) }
}

function asciiHeaderValue(value: unknown) {
  const text = String(value ?? '')
  return Array.from(text, character => character.charCodeAt(0) > 0xff ? encodeURIComponent(character) : character).join('')
}

async function safeFetch(input: RequestInfo | URL, init?: RequestInit, timeoutMs = 10_000) {
  const sourceSignal = init?.signal || (typeof Request !== 'undefined' && input instanceof Request ? input.signal : undefined)
  const deadline = AbortSignal.timeout(timeoutMs)
  const signal = sourceSignal ? AbortSignal.any([sourceSignal, deadline]) : deadline
  const options: RequestInit = { ...init, signal }
  if (init?.headers) {
    const headers: Record<string, string> = {}
    const source = init.headers
    if (typeof Headers !== 'undefined' && source instanceof Headers) {
      source.forEach((value, key) => { headers[key] = asciiHeaderValue(value) })
    } else if (Array.isArray(source)) {
      source.forEach(([key, value]) => { headers[key] = asciiHeaderValue(value) })
    } else {
      Object.entries(source).forEach(([key, value]) => { headers[key] = asciiHeaderValue(value) })
    }
    options.headers = headers
  }
  const address = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  let path = ''
  let refreshRequest = false
  try {
    const url = new URL(address)
    path = url.pathname
    refreshRequest = /\/auth\/v1\/token$/.test(path) && url.searchParams.get('grant_type') === 'refresh_token'
  } catch { path = '(relative request)' }
  const started = Date.now()
  // 不输出 URL 查询参数、请求头、请求体或会话对象。
  if (import.meta.dev) console.info('[LoveSupabase] request start', { method: options.method || 'GET', path })
  try {
    const response = await fetch(input, options)
    if (import.meta.dev) console.info('[LoveSupabase] response', { path, status: response.status, elapsedMs: Date.now() - started })
    // CDN/静态托管的 HTML 错误页不是 Auth 对 refresh token 的有效裁决。
    // SDK 会把普通 4xx 当成令牌失效并清会话；503 允许它沿用既有重试机制。
    // 真正的 Supabase JSON 错误保持原样，撤销或过期的会话仍须重新登录。
    if (refreshRequest && /\btext\/html\b/i.test(response.headers.get('content-type') || '')) {
      void response.body?.cancel().catch(() => {})
      return new Response(JSON.stringify({ code: 'auth_service_unavailable', msg: '登录服务暂时不可用，请检查网络或部署配置后重试。' }), {
        status: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      })
    }
    return response
  } catch (error) {
    if (import.meta.dev) console.warn('[LoveSupabase] request failed', { path, elapsedMs: Date.now() - started, reason: deadline.aborted ? 'timeout' : sourceSignal?.aborted ? 'cancelled' : 'network' })
    throw error
  }
}

/** 仅将当前云项目的认证和 REST 请求交给本站 Nitro；图片上传与 WebSocket 保持原通道。 */
function browserRelay(input: RequestInfo | URL, upstreamUrl: string, isClient: boolean) {
  if (!isClient || typeof window === 'undefined' || Capacitor.isNativePlatform()
    || !/^https?:$/.test(window.location.protocol)) return input
  try {
    const upstream = new URL(upstreamUrl)
    const address = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const prefix = upstream.pathname.replace(/\/$/, '')
    if (upstream.protocol !== 'https:' || address.origin !== upstream.origin) return input
    const path = address.pathname.slice(prefix.length)
    if (!address.pathname.startsWith(`${prefix}/`) || !/^\/(auth|rest)\/v1(?:\/|$)/.test(path)) return input
    const relay = new URL(`/api/supabase${path}${address.search}`, window.location.origin)
    return typeof Request !== 'undefined' && input instanceof Request ? new Request(relay.href, input) : relay.href
  } catch { return input }
}

/** 用户主动恢复时只移除当前 Supabase 项目的本机会话，不清除其他站点数据。 */
export function clearSupabaseLocalSession(url: string): void {
  if (typeof window === 'undefined') return
  const project = new URL(url).hostname.split('.')[0]
  if (!project) throw new Error('登录服务配置无效，无法清理本机会话。')
  const key = `sb-${project}-auth-token`
  for (const suffix of ['', '-user', '-code-verifier']) window.localStorage.removeItem(key + suffix)
}

/** 唯一的 SDK 初始化入口；由 Nuxt 插件逐实例调用，不能缓存为 SSR 全局单例。 */
export function createSupabaseClient({ url, anonKey, isClient }: SupabaseClientConfig): AppSupabaseClient | null {
  if (!url || !anonKey) return null

  const client = createClient<Database>(url, anonKey, {
    global: { fetch: (input, init) => {
      const target = browserRelay(input, url, isClient)
      // 上游截止 10 秒，浏览器留出服务端转发开销；SDK 的总恢复预算由认证层单独限制。
      return safeFetch(target, target === input ? init : { ...init, credentials: 'omit' }, target === input ? 10_000 : 12_000)
    } },
    auth: {
      persistSession: isClient,
      autoRefreshToken: isClient,
      detectSessionInUrl: isClient,
      // 显式提供 SDK 支持的适配器，避免浏览器拒绝存储时静默退回内存。
      ...(isClient ? { storage: browserSessionStorage() } : {}),
    },
  })
  return Object.assign(client, { resumableUploadUrl: `${url.replace(/\/$/, '')}/storage/v1/upload/resumable` })
}
