import { createError, defineEventHandler, getHeader, getRequestURL, getRouterParam, send, setHeader, setResponseStatus } from 'h3'
import { readRelayBody, supabaseRelayTarget, SUPABASE_RELAY_REQUEST_HEADERS, SUPABASE_RELAY_RESPONSE_HEADERS } from '../../utils/supabaseRelay'

/** Same-origin Auth/REST bridge; Supabase still authenticates every request and enforces RLS. */
export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'private, no-store, max-age=0')
  if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'HEAD'].includes(event.method)) {
    throw createError({ statusCode: 405, message: '不支持此请求方式。' })
  }
  const config = useRuntimeConfig(event)
  const key = String(config.public.supabaseAnonKey || '')
  if (!key) throw createError({ statusCode: 503, message: '登录服务尚未配置。' })
  const path = getRouterParam(event, 'path') || ''
  const target = supabaseRelayTarget(String(config.public.supabaseUrl || ''), path, getRequestURL(event).search)
  const body = await readRelayBody(event, path.startsWith('auth/') ? 65536 : 1048576)
  const headers = new Headers({ apikey: key })
  for (const name of SUPABASE_RELAY_REQUEST_HEADERS) {
    const value = getHeader(event, name)
    if (value) headers.set(name, value)
  }
  const controller = new AbortController()
  let timeout = false
  const timer = setTimeout(() => { timeout = true; controller.abort() }, 10000)
  const disconnect = () => { if (!event.node.res.writableEnded) controller.abort() }
  event.node.res.once('close', disconnect)
  try {
    const response = await fetch(target, {
      method: event.method, headers, ...(body?.length ? { body: Uint8Array.from(body) } : {}),
      signal: controller.signal, redirect: 'manual',
    })
    // Do not follow upstream redirects with credentials or redirect the browser
    // back onto the very network path this relay is meant to avoid.
    if (response.status >= 300 && response.status < 400) {
      void response.body?.cancel().catch(() => {})
      throw new Error('Unexpected upstream redirect')
    }
    const payload = event.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer())
    if (event.node.res.destroyed) return
    for (const name of SUPABASE_RELAY_RESPONSE_HEADERS) {
      const value = response.headers.get(name)
      if (value) setHeader(event, name, value)
    }
    setResponseStatus(event, response.status)
    return send(event, payload)
  } catch {
    if (event.node.res.destroyed) return
    // Raw network exceptions can contain URLs, request headers or tokens.
    throw createError({ statusCode: timeout ? 504 : 502,
      message: timeout ? '登录服务响应超时，请稍后重试。' : '暂时无法连接登录服务，请稍后重试。',
      data: { code: timeout ? 'SUPABASE_TIMEOUT' : 'SUPABASE_UNAVAILABLE' },
    })
  } finally {
    clearTimeout(timer)
    event.node.res.off('close', disconnect)
    controller.abort()
  }
})
