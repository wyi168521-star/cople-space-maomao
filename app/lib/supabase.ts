import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { Capacitor } from '@capacitor/core'
import type { Database } from '../types/database.generated'

export type AppSupabaseClient = SupabaseClient<Database> & { resumableUploadUrl: string }

export type SupabaseClientConfig = {
  url: string
  anonKey: string
  isClient: boolean
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
  try { path = new URL(address).pathname } catch { path = '(relative request)' }
  const started = Date.now()
  // 不输出 URL 查询参数、请求头、请求体或会话对象。
  if (import.meta.dev) console.info('[LoveSupabase] request start', { method: options.method || 'GET', path })
  try {
    const response = await fetch(input, options)
    if (import.meta.dev) console.info('[LoveSupabase] response', { path, status: response.status, elapsedMs: Date.now() - started })
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
    },
  })
  return Object.assign(client, { resumableUploadUrl: `${url.replace(/\/$/, '')}/storage/v1/upload/resumable` })
}
