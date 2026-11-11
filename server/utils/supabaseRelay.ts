import { createError, getHeader, readRawBody, type H3Event } from 'h3'

/** Only this project's Auth / REST endpoints may be reached through the relay. */
export function supabaseRelayTarget(base: string, rawPath: string, search = '') {
  let upstream: URL
  try { upstream = new URL(base) }
  catch { throw createError({ statusCode: 503, message: '登录服务尚未配置。' }) }
  if (!['https:', 'http:'].includes(upstream.protocol) || upstream.username || upstream.password || upstream.search || upstream.hash) {
    throw createError({ statusCode: 503, message: '登录服务配置无效。' })
  }
  let path: string
  try { path = decodeURIComponent(rawPath) }
  catch { throw createError({ statusCode: 400, message: '请求路径无效。' }) }
  // Do not allow URL normalization, encoded separators or another decode to
  // turn a permitted prefix into another service/admin path.
  if (path !== rawPath || /[\\\s?#%]/.test(path) || path.includes('//') || path.split('/').some(part => part === '.' || part === '..')
    || !/^(auth|rest)\/v1(?:\/|$)/.test(path) || /^auth\/v1\/admin(?:\/|$)/i.test(path)) {
    throw createError({ statusCode: 404, message: '此服务不支持转发。' })
  }
  upstream.pathname = `${upstream.pathname.replace(/\/$/, '')}/${path}`
  upstream.search = search
  return upstream
}

export const SUPABASE_RELAY_REQUEST_HEADERS = [
  'authorization', 'accept', 'content-type', 'prefer', 'range', 'range-unit',
  'accept-profile', 'content-profile', 'x-supabase-api-version', 'x-client-info',
] as const
export const SUPABASE_RELAY_RESPONSE_HEADERS = [
  'content-type', 'content-range', 'range-unit', 'preference-applied', 'www-authenticate', 'retry-after',
] as const

/** Cap streamed bodies before buffering; do not log passwords or session data. */
export async function readRelayBody(event: H3Event, limit: number): Promise<Buffer | undefined> {
  if (['GET', 'HEAD'].includes(event.method)) return undefined
  if (Number(getHeader(event, 'content-length') || 0) > limit) {
    throw createError({ statusCode: 413, message: '请求内容太大。' })
  }
  const request = event.node.req
  // Server adapters may already have buffered the body before reaching H3.
  if ('rawBody' in request || 'body' in request || '__unenv__' in request || event.web?.request) {
    const body = await readRawBody(event, false)
    if (body && body.byteLength > limit) throw createError({ statusCode: 413, message: '请求内容太大。' })
    return body
  }
  if (request.readableEnded) return undefined
  return new Promise<Buffer>((resolve, reject) => {
    let size = 0
    let chunks: Buffer[] = []
    const cleanup = () => {
      request.off('data', onData); request.off('end', onEnd)
      request.off('error', onError); request.off('aborted', onAborted)
    }
    const onData = (chunk: Buffer) => {
      size += chunk.byteLength
      if (size > limit) {
        chunks = []; cleanup(); request.resume()
        reject(createError({ statusCode: 413, message: '请求内容太大。' }))
      } else chunks.push(chunk)
    }
    const onEnd = () => { cleanup(); resolve(Buffer.concat(chunks, size)) }
    const onError = () => { cleanup(); reject(createError({ statusCode: 400, message: '无法读取请求内容。' })) }
    const onAborted = () => { cleanup(); reject(createError({ statusCode: 400, message: '请求已取消。' })) }
    request.on('data', onData).once('end', onEnd).once('error', onError).once('aborted', onAborted)
  })
}
