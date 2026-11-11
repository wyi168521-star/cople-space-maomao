// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, request as httpRequest, type Server } from 'node:http'
import { createApp, defineEventHandler, toNodeListener } from 'h3'
import handler from '../server/api/supabase/[...path]'
import { supabaseRelayTarget } from '../server/utils/supabaseRelay'

const nativeFetch = globalThis.fetch
const upstream = vi.fn()
const project = 'https://our-project.supabase.co'
const publicKey = 'test-only-publishable-key'
let server: Server, origin = '', configured = true

beforeAll(async () => {
  const app = createApp()
  app.use(defineEventHandler(event => {
    event.context.params = { path: event.path.split('?')[0]!.replace(/^\/api\/supabase\//, '') }
  }))
  app.use(handler)
  server = createServer(toNodeListener(app))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing server address')
  origin = `http://127.0.0.1:${address.port}`
})
afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
beforeEach(() => {
  configured = true
  vi.stubGlobal('useRuntimeConfig', () => ({ public: { supabaseUrl: project, supabaseAnonKey: configured ? publicKey : '' } }))
  upstream.mockReset().mockResolvedValue(new Response('{}', { headers: { 'content-type': 'application/json' } }))
  vi.stubGlobal('fetch', upstream)
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })

const call = (path: string, init?: RequestInit) => nativeFetch(`${origin}/api/supabase/${path}`, init)

describe('same-origin Supabase relay', () => {
  it('forwards token requests unchanged with configured apikey and only allowed headers', async () => {
    const body = '{"email":"person@example.test","password":"test-password"}'
    upstream.mockResolvedValueOnce(new Response('{"access_token":"test-session"}', { headers: {
      'content-type': 'application/json', 'set-cookie': 'should-not-be-forwarded=1', 'x-upstream-private': 'hidden',
    } }))
    const response = await call('auth/v1/token?grant_type=password', {
      method: 'POST', body, headers: {
        'content-type': 'application/json', authorization: 'Bearer test-user-token', apikey: 'client-provided-key',
        cookie: 'private=1', origin: 'https://other.example', 'x-private': 'never-forward', 'x-supabase-api-version': '2024-01-01',
      },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ access_token: 'test-session' })
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('x-upstream-private')).toBeNull()
    const [url, options] = upstream.mock.calls[0]!
    expect(String(url)).toBe(`${project}/auth/v1/token?grant_type=password`)
    expect(Buffer.from(options.body).toString()).toBe(body)
    expect(options.redirect).toBe('manual')
    expect(options.headers.get('apikey')).toBe(publicKey)
    expect(options.headers.get('authorization')).toBe('Bearer test-user-token')
    expect(options.headers.get('x-supabase-api-version')).toBe('2024-01-01')
    for (const header of ['cookie', 'origin', 'host', 'x-private']) expect(options.headers.has(header)).toBe(false)
  })

  it('preserves REST filters, count HEAD headers and user authorization', async () => {
    upstream.mockResolvedValueOnce(new Response(null, { headers: { 'content-range': '*/12', 'range-unit': 'items' } }))
    const response = await call('rest/v1/memories?select=*&couple_id=eq.test-id', {
      method: 'HEAD', headers: { authorization: 'Bearer user-jwt', prefer: 'count=exact', range: '0-9', 'accept-profile': 'public' },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-range')).toBe('*/12')
    expect(await response.text()).toBe('')
    const [url, options] = upstream.mock.calls[0]!
    expect(String(url)).toBe(`${project}/rest/v1/memories?select=*&couple_id=eq.test-id`)
    expect(options.method).toBe('HEAD')
    expect(options).not.toHaveProperty('body')
    expect(options.headers.get('prefer')).toBe('count=exact')
    expect(options.headers.get('range')).toBe('0-9')
    expect(options.headers.get('authorization')).toBe('Bearer user-jwt')
  })

  it('preserves Supabase error bodies/status and RPC writes without elevating permissions', async () => {
    upstream.mockResolvedValueOnce(new Response('{"code":"bad_jwt","message":"JWT expired"}', { status: 401, headers: {
      'content-type': 'application/json', 'www-authenticate': 'Bearer',
    } }))
    const response = await call('rest/v1/rpc/join_couple', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"p_couple_id":"test-id"}' })
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ code: 'bad_jwt', message: 'JWT expired' })
    expect(response.headers.get('www-authenticate')).toBe('Bearer')
    expect(upstream.mock.calls[0]![1].headers.get('apikey')).toBe(publicKey)
  })

  it.each(['storage/v1/object/private/file.jpg', 'auth/v1/admin/users', 'auth/v1/%61dmin/users', '//attacker.example/rest/v1/x', 'rest/v1/../auth/v1/admin', 'rest/v1/rpc%2funsafe'])('refuses unsupported or ambiguous path %s', async path => {
    expect(() => supabaseRelayTarget(project, path)).toThrow()
    expect(upstream).not.toHaveBeenCalled()
  })

  it('does not allow query parameters to choose an upstream host', () => {
    const target = supabaseRelayTarget(project, 'auth/v1/settings', '?url=https://other.example&x=1')
    expect(target.origin).toBe(project)
    expect(target.search).toBe('?url=https://other.example&x=1')
    expect(() => supabaseRelayTarget('https://user:password@other.example', 'auth/v1/token')).toThrow()
  })

  it('rejects missing configuration and unsupported HTTP methods without fetching', async () => {
    configured = false
    expect((await call('auth/v1/token')).status).toBe(503)
    configured = true
    expect((await call('auth/v1/token', { method: 'OPTIONS' })).status).toBe(405)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('caps auth bodies before contacting the upstream', async () => {
    expect((await call('auth/v1/token', { method: 'POST', body: 'x'.repeat(65537) })).status).toBe(413)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('also limits chunked bodies that omit content-length', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(`${origin}/api/supabase/auth/v1/token`, { method: 'POST', headers: { 'transfer-encoding': 'chunked' } }, response => {
        response.resume()
        response.on('end', () => resolve(response.statusCode!))
      })
      request.on('error', reject)
      request.write('x'.repeat(40000)); request.end('x'.repeat(40000))
    })
    expect(status).toBe(413)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('blocks upstream redirects and sanitizes network errors', async () => {
    upstream.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://unexpected.example' } }))
    const redirect = await call('auth/v1/user')
    expect(redirect.status).toBe(502)
    expect(redirect.headers.get('location')).toBeNull()
    upstream.mockRejectedValueOnce(new Error('request contained private-token-password'))
    const failure = await call('auth/v1/user')
    expect(failure.status).toBe(502)
    expect(await failure.text()).not.toContain('private-token-password')
  })

  it('bounds the whole upstream response and cancels after ten seconds', async () => {
    const realTimeout = globalThis.setTimeout
    // Keep native HTTP client timers intact; accelerate just this handler's deadline.
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) =>
      realTimeout(fn, ms === 10000 ? 20 : ms, ...args)) as typeof setTimeout)
    let signal: AbortSignal | undefined
    upstream.mockImplementationOnce(async (_url, options) => {
      signal = options.signal
      return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('private upstream error')), { once: true }))
    })
    const response = await call('auth/v1/user')
    expect(response.status).toBe(504)
    expect(signal?.aborted).toBe(true)
    const body = await response.text()
    expect(body).toContain('SUPABASE_TIMEOUT')
    expect(body).not.toContain('private upstream error')
  })

  it('cancels the upstream if the browser disconnects', async () => {
    let signal: AbortSignal | undefined
    upstream.mockImplementationOnce(async (_url, options) => {
      signal = options.signal
      return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }))
    })
    const controller = new AbortController()
    const pending = call('auth/v1/user', { signal: controller.signal })
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(signal).toBeDefined())
    controller.abort()
    await rejected
    await vi.waitFor(() => expect(signal!.aborted).toBe(true))
  })
})
