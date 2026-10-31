// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { createApp, toNodeListener } from 'h3'
import loveQuote from '../server/api/ai/love-quote.post'
import dailyDiary from '../server/api/ai/daily-diary.post'

const { external } = vi.hoisted(() => ({ external: vi.fn() }))
vi.mock('ofetch', () => ({ $fetch: external }))
let server: Server, origin = '', userId = '', key = '', content = '', unpaired = false
let authFailure: unknown, upstreamFailure: unknown
const coupleId = '10000000-0000-0000-0000-000000000001'
const sentinel = 'server-only-test-key-NEVER-IN-RESPONSE'
const payload = { coupleName: '小林和小许', daysTogether: 520 }
const post = (route: string, body: unknown = payload, authenticated = true) => fetch(origin + route, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: 'Bearer test-session-token' } : {}) },
  body: JSON.stringify(body),
})

beforeAll(async () => {
  const app = createApp().use('/quote', loveQuote).use('/diary', dailyDiary)
  server = createServer(toNodeListener(app))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing test server address')
  origin = `http://127.0.0.1:${address.port}`
})
afterAll(async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) })
beforeEach(() => {
  userId = crypto.randomUUID(); key = sentinel; content = '和你一起，把日子过成诗。'; unpaired = false
  authFailure = upstreamFailure = undefined
  vi.stubEnv('DEEPSEEK_API_KEY', '')
  vi.stubGlobal('useRuntimeConfig', () => ({ deepseekApiKey: key, deepseekModel: 'deepseek-flash',
    public: { supabaseUrl: 'https://auth.example', supabaseAnonKey: 'public-test-key' } }))
  external.mockReset().mockImplementation(async (url: string) => {
    if (url.endsWith('/auth/v1/user')) { if (authFailure) throw authFailure; return { id: userId } }
    if (url.endsWith('/rest/v1/couple_members')) return unpaired ? [] : [{ couple_id: coupleId }]
    if (upstreamFailure) throw upstreamFailure
    return { choices: [{ message: { content }, finish_reason: 'stop' }] }
  })
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('Nuxt AI handlers over HTTP', () => {
  it('rejects anonymous and unpaired users before contacting the model', async () => {
    expect((await post('/quote', payload, false)).status).toBe(401)
    expect(external).not.toHaveBeenCalled()
    unpaired = true
    expect((await post('/quote')).status).toBe(403)
    expect(external.mock.calls.some(([url]) => String(url).includes('deepseek.com'))).toBe(false)
  })
  it('distinguishes expired sessions from an unavailable auth service without leaking details', async () => {
    authFailure = { statusCode: 401, message: sentinel }
    const expired = await post('/quote')
    expect(expired.status).toBe(401); expect(await expired.text()).not.toContain(sentinel)
    authFailure = new Error(sentinel)
    expect((await post('/quote')).status).toBe(503)
  })
  it('validates input and responds usefully when the key is absent', async () => {
    expect((await post('/quote', { ...payload, daysTogether: -1 })).status).toBe(400)
    expect((await post('/diary', { memories: 'not an array' })).status).toBe(400)
    key = ''
    const result = await post('/quote')
    expect(result.status).toBe(503)
    expect((await result.json()).data.code).toBe('AI_NOT_CONFIGURED')
    expect(external.mock.calls.some(([url]) => String(url).includes('deepseek.com'))).toBe(false)
  })
  it('keeps the key in the upstream header and returns only generated text', async () => {
    const result = await post('/quote', { ...payload, apiKey: 'ignored-client-key' })
    expect(result.status).toBe(200)
    expect(result.headers.get('cache-control')).toBe('no-store')
    expect(await result.json()).toEqual({ text: content, source: 'ai' })
    const call = external.mock.calls.find(([url]) => String(url).includes('deepseek.com'))!
    expect(call[0]).toBe('https://api.deepseek.com/chat/completions')
    expect(call[1]).toMatchObject({ method: 'POST', retry: 0, timeout: 20000, headers: { Authorization: `Bearer ${sentinel}` },
      body: { model: 'deepseek-flash', max_tokens: 128, stream: false, thinking: { type: 'disabled' } } })
    expect(JSON.stringify(call[1].body)).not.toContain(sentinel)
    expect(JSON.stringify(call[1].body)).not.toContain('ignored-client-key')
  })
  it('supports the private legacy environment alias at request time without a build default', async () => {
    key = ''
    vi.stubEnv('DEEPSEEK_API_KEY', sentinel)
    const result = await post('/quote')
    expect(result.status).toBe(200)
    const call = external.mock.calls.find(([url]) => String(url).includes('deepseek.com'))!
    expect(call[1].headers.Authorization).toBe(`Bearer ${sentinel}`)
    expect(await result.text()).not.toContain(sentinel)
  })
  it('uses selected diary content with bounded output and no unnecessary memory metadata', async () => {
    content = '今天和你一起看海，晚霞落在我们肩上。这些细小的记忆，我都想好好收藏。'
    const result = await post('/diary', { memories: [{ title: '看海', body: '一起看晚霞', location: '海边', storage_path: 'private-path' }] })
    expect(result.status).toBe(200)
    expect((await result.json()).text).toBe(content)
    const options = external.mock.calls.find(([url]) => String(url).includes('deepseek.com'))![1]
    expect(options).toMatchObject({ timeout: 30000, body: { max_tokens: 900 } })
    expect(options.body.messages[1].content).toContain('一起看晚霞')
    expect(options.body.messages[1].content).not.toContain('private-path')
  })
  it('sanitizes upstream failures and rejects empty, truncated or overlong quotes', async () => {
    upstreamFailure = { message: `Authorization: Bearer ${sentinel}`, data: { privateMemory: 'private diary body' } }
    const failed = await post('/quote')
    expect(failed.status).toBe(502)
    const body = await failed.text()
    expect(body).not.toContain(sentinel); expect(body).not.toContain('private diary body')
    upstreamFailure = undefined
    content = '字'.repeat(21)
    expect((await post('/quote')).status).toBe(502)
    content = '  '
    expect((await post('/quote')).status).toBe(502)
    external.mockImplementation(async (url: string) => url.endsWith('/auth/v1/user') ? { id: userId }
      : url.includes('/rest/v1/') ? [{ couple_id: coupleId }] : { choices: [{ message: { content: '未完成' }, finish_reason: 'length' }] })
    expect((await post('/quote')).status).toBe(502)
  })
  it('rejects oversized JSON before invoking the model', async () => {
    const result = await post('/quote', { ...payload, extra: 'x'.repeat(66000) })
    expect(result.status).toBe(413)
    expect(external.mock.calls.some(([url]) => String(url).includes('deepseek.com'))).toBe(false)
  })
  it('reports a safe quota reason when the provider returns 402', async () => {
    upstreamFailure = { statusCode: 402, message: sentinel }
    const response = await post('/quote')
    expect(response.status).toBe(503)
    const result = await response.json()
    expect(result.data.code).toBe('AI_BALANCE_INSUFFICIENT')
    expect(JSON.stringify(result)).not.toContain(sentinel)
  })
  it('enforces the generation limit using the verified user, ignoring forged body identities', async () => {
    for (let index = 0; index < 20; index++) {
      expect((await post('/quote', { ...payload, user_id: `forged-${index}` })).status).toBe(200)
    }
    const limited = await post('/quote', { ...payload, user_id: 'another-forged-user' })
    expect(limited.status).toBe(429)
    expect((await limited.json()).data.code).toBe('AI_RATE_LIMITED')
    expect(external.mock.calls.filter(([url]) => String(url).includes('deepseek.com'))).toHaveLength(20)
  })
})
