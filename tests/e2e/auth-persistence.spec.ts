import { chromium, devices, expect, test, type BrowserContext, type Page } from '@playwright/test'

// 全部账号、JWT 和后台响应都是测试夹具，不创建云端账号或调用付费 AI。
const account = {
  id: '10000000-0000-0000-0000-000000000001', aud: 'authenticated', role: 'authenticated',
  email: 'persistence@example.test', email_confirmed_at: '2026-01-01T00:00:00Z',
  user_metadata: { display_name: '测试用户' }, app_metadata: { provider: 'email' }, created_at: '2026-01-01T00:00:00Z',
}
const coupleId = '20000000-0000-0000-0000-000000000002'
type Device = { paired: boolean; revoked: boolean; logins: number; refreshes: number; logoutScopes: string[]; logoutOffline?: boolean }
const device = (paired = true): Device => ({ paired, revoked: false, logins: 0, refreshes: 0, logoutScopes: [] })

function session(expired = false) {
  const exp = Math.floor(Date.now() / 1000) + (expired ? -3600 : 3600)
  const jwt = [Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'), Buffer.from(JSON.stringify({ sub: account.id, exp, aud: 'authenticated', role: 'authenticated' })).toString('base64url'), 'mock-signature'].join('.')
  return { user: account, access_token: jwt, refresh_token: 'mock-refresh-only', expires_at: exp, expires_in: 3600, token_type: 'bearer' }
}

async function mockBackend(context: BrowserContext, state: Device, allDevices = [state]) {
  await context.route('**/api/ai/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }))
  await context.route(url => /\/(?:auth|rest)\/v1(?:\/|$)/.test(url.pathname), async route => {
    const url = new URL(route.request().url())
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (url.pathname.endsWith('/auth/v1/token')) {
      if (url.searchParams.get('grant_type') === 'refresh_token') {
        state.refreshes++
        if (state.revoked) return json({ code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' }, 400)
      } else { state.logins++; state.revoked = false }
      return json(session())
    }
    if (url.pathname.endsWith('/auth/v1/user')) return json(account)
    if (url.pathname.endsWith('/auth/v1/logout')) {
      const scope = url.searchParams.get('scope') || 'global'
      state.logoutScopes.push(scope)
      if (state.logoutOffline) return route.abort('connectionreset')
      for (const other of scope === 'local' ? [state] : allDevices) other.revoked = true
      return route.fulfill({ status: 204 })
    }
    if (url.pathname.endsWith('/rest/v1/couple_members')) return json(state.paired ? {
      couple_id: coupleId, role: 'a', couples: { name_a: '测试甲', name_b: '测试乙', start_date: '2024-05-20' },
    } : null)
    return route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'content-range': '0-0/0' }, body: '[]' })
  })
}

async function signIn(page: Page, origin: string) {
  await page.goto(`${origin}/login`)
  await expect(page.locator('#auth-email')).toBeEnabled()
  await page.locator('#auth-email').fill(account.email)
  await page.locator('#auth-password').fill('mock-password-only')
  await page.getByRole('button', { name: '登录 Love小家', exact: true }).click()
}

async function expectHome(page: Page, origin: string) {
  await expect(page).toHaveURL(`${origin}/`)
  await expect(page.locator('#home-couple-id')).toHaveValue(coupleId)
}

test.setTimeout(90_000)

test('persists through reload, closed tabs and a restarted browser, but not explicit logout', async ({}, testInfo) => {
  const origin = String(testInfo.project.use.baseURL).replace(/\/$/, '')
  const profile = testInfo.outputPath('isolated-browser-profile')
  const state = device()
  const open = async () => {
    const context = await chromium.launchPersistentContext(profile, {
      ...(testInfo.project.name === 'mobile' ? devices['Pixel 5'] : devices['Desktop Chrome']),
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      headless: true, serviceWorkers: 'block',
    })
    await mockBackend(context, state)
    return context
  }
  let context = await open()
  try {
    let page = await context.newPage()
    await signIn(page, origin)
    await expectHome(page, origin)
    await page.reload()
    await expectHome(page, origin)
    const kept = await context.newPage()
    await page.close()
    page = kept
    await page.goto(`${origin}/login`)
    await expectHome(page, origin)

    await context.close()
    context = await open()
    page = await context.newPage()
    await page.goto(`${origin}/login`)
    await expectHome(page, origin)
    expect(state.logins).toBe(1)

    await page.getByRole('button', { name: '退出登录', exact: true }).click()
    await expect(page.locator('#auth-email')).toBeEnabled()
    expect(state.logoutScopes).toEqual(['local'])
    await context.close()
    context = await open()
    page = await context.newPage()
    await page.goto(`${origin}/timeline`)
    await expect(page).toHaveURL(`${origin}/login`)
    await expect(page.locator('#auth-email')).toBeEnabled()
    expect(state.logins).toBe(1)
  } finally { await context.close() }
})

test('logging out one device does not revoke the other device session', async ({ browser }, testInfo) => {
  const origin = String(testInfo.project.use.baseURL).replace(/\/$/, '')
  const a = device(), b = device(), states = [a, b]
  const contexts = await Promise.all([browser.newContext({ serviceWorkers: 'block' }), browser.newContext({ serviceWorkers: 'block' })])
  try {
    await mockBackend(contexts[0]!, a, states)
    await mockBackend(contexts[1]!, b, states)
    const first = await contexts[0]!.newPage(), second = await contexts[1]!.newPage()
    await signIn(first, origin); await expectHome(first, origin)
    await signIn(second, origin); await expectHome(second, origin)
    await first.getByRole('button', { name: '退出登录', exact: true }).click()
    await expect(first.locator('#auth-email')).toBeEnabled()
    expect(b.revoked).toBe(false)
    // 第二台设备在重开页面时必须真的刷新令牌，才能发现被全局撤销的问题。
    await second.evaluate(expired => {
      const key = Object.keys(localStorage).find(key => /^sb-.+-auth-token$/.test(key))
      if (!key) throw new Error('Missing test session')
      localStorage.setItem(key, JSON.stringify(expired))
    }, session(true))
    await second.reload()
    await expectHome(second, origin)
    expect(b.refreshes).toBeGreaterThan(0)
    expect(b.logins).toBe(1)
  } finally { await Promise.all(contexts.map(context => context.close())) }
})

test('restores an unpaired account to pairing instead of requiring another login', async ({ context, page }, testInfo) => {
  const origin = String(testInfo.project.use.baseURL).replace(/\/$/, '')
  const state = device(false)
  await mockBackend(context, state)
  await signIn(page, origin)
  await expect(page).toHaveURL(`${origin}/pairing`)
  await page.reload()
  await expect(page).toHaveURL(`${origin}/pairing`)
  await page.goto(`${origin}/login`)
  await expect(page).toHaveURL(`${origin}/pairing`)
  expect(state.logins).toBe(1)
})

test('shows a retryable storage error rather than silently losing a login on restart', async ({ context, page }, testInfo) => {
  const origin = String(testInfo.project.use.baseURL).replace(/\/$/, '')
  const state = device()
  await mockBackend(context, state)
  await context.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('Blocked', 'SecurityError') } })
  })
  await page.goto(`${origin}/login`)
  await expect(page.getByRole('alert')).toContainText('无法保存登录状态')
  await expect(page.getByRole('button', { name: '重新检查登录状态', exact: true })).toBeEnabled()
  expect(state.logins).toBe(0)
})

test('does not resurrect a locally cleared session after a failed remote logout', async ({ context, page }, testInfo) => {
  const origin = String(testInfo.project.use.baseURL).replace(/\/$/, '')
  const state = device()
  state.logoutOffline = true
  await mockBackend(context, state)
  await signIn(page, origin)
  await expectHome(page, origin)
  await page.getByRole('button', { name: '退出登录', exact: true }).click()
  await expect(page.locator('#auth-email')).toBeEnabled()
  await page.reload()
  await expect(page.locator('#auth-email')).toBeEnabled()
  expect(state.logins).toBe(1)
})
