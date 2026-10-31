import { createClient, type SupabaseClient } from '@supabase/supabase-js'
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

async function safeFetch(input: RequestInfo | URL, init?: RequestInit) {
  const sourceSignal = init?.signal || (typeof Request !== 'undefined' && input instanceof Request ? input.signal : undefined)
  const deadline = AbortSignal.timeout(10_000)
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

/** 唯一的 SDK 初始化入口；由 Nuxt 插件逐实例调用，不能缓存为 SSR 全局单例。 */
export function createSupabaseClient({ url, anonKey, isClient }: SupabaseClientConfig): AppSupabaseClient | null {
  if (!url || !anonKey) return null

  const client = createClient<Database>(url, anonKey, {
    global: { fetch: safeFetch },
    auth: {
      persistSession: isClient,
      autoRefreshToken: isClient,
      detectSessionInUrl: isClient,
    },
  })
  return Object.assign(client, { resumableUploadUrl: `${url.replace(/\/$/, '')}/storage/v1/upload/resumable` })
}
