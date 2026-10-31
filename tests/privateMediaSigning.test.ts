import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPrivateMediaSignedUrls } from '../app/composables/useMediaUrls'

type SigningClient = NonNullable<Parameters<typeof createPrivateMediaSignedUrls>[0]>
type SigningApi = ReturnType<SigningClient['storage']['from']>
type BatchSigner = NonNullable<SigningApi['createSignedUrls']>

function signingClient(overrides: Partial<SigningApi> = {}) {
  const createSignedUrl = vi.fn<SigningApi['createSignedUrl']>(async path => ({
    data: { signedUrl: `https://signed.example/${path}` }, error: null,
  }))
  const api: SigningApi = { upload: vi.fn(async () => ({ error: null })), createSignedUrl, ...overrides }
  const from = vi.fn((_bucket: string) => api)
  return { client: { storage: { from } } satisfies SigningClient, from, createSignedUrl }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('private media signing without a shared cache', () => {
  it('supports direct one-hour signing even when the SDK exposes a batch endpoint', async () => {
    const batch = vi.fn<BatchSigner>()
    const { client, createSignedUrl } = signingClient({ createSignedUrls: batch })
    const result = await createPrivateMediaSignedUrls(client, [{ path: 'album/photo.jpg' }], 3600, { batch: false })
    expect(batch).not.toHaveBeenCalled()
    expect(createSignedUrl).toHaveBeenCalledExactlyOnceWith('album/photo.jpg', 3600)
    expect(result.has('couple-media:album/photo.jpg')).toBe(true)
  })

  it('deduplicates paths within each bucket and forwards the default lifetime', async () => {
    const batch = vi.fn<BatchSigner>(async paths => ({
      data: paths.map(path => ({ path, signedUrl: `https://batch.example/${path}` })), error: null,
    }))
    const { client, from, createSignedUrl } = signingClient({ createSignedUrls: batch })
    const result = await createPrivateMediaSignedUrls(client, [
      { path: 'cover-a.jpg' }, { path: 'cover-a.jpg', bucket: 'couple-media' },
      { path: 'cover-b.jpg' }, { path: 'cover-a.jpg', bucket: 'other-private' }, { path: '' },
    ])

    expect(from.mock.calls.map(([bucket]) => bucket)).toEqual(['couple-media', 'other-private'])
    expect(batch).toHaveBeenCalledTimes(2)
    expect(batch).toHaveBeenCalledWith(['cover-a.jpg', 'cover-b.jpg'], 3600)
    expect(batch).toHaveBeenCalledWith(['cover-a.jpg'], 3600)
    expect(createSignedUrl).not.toHaveBeenCalled()
    expect([...result.keys()].sort()).toEqual([
      'couple-media:cover-a.jpg', 'couple-media:cover-b.jpg', 'other-private:cover-a.jpg',
    ])
  })

  it('falls back for missing objects while preserving successful batch results', async () => {
    const batch = vi.fn<BatchSigner>(async () => ({
      data: [
        { path: 'cover-a.jpg', signedUrl: 'https://batch.example/a' },
        { path: 'cover-b.jpg', signedUrl: null },
        { path: 'unrequested.jpg', signedUrl: 'https://batch.example/unrequested' },
      ], error: null,
    }))
    const single = vi.fn<SigningApi['createSignedUrl']>(async path => {
      if (path === 'cover-c.jpg') throw new Error('unavailable')
      return { data: { signedUrl: 'https://single.example/b' }, error: null }
    })
    const { client } = signingClient({ createSignedUrls: batch, createSignedUrl: single })
    const result = await createPrivateMediaSignedUrls(client, [
      { path: 'cover-a.jpg' }, { path: 'cover-b.jpg' }, { path: 'cover-c.jpg' },
    ], 900)

    expect(batch).toHaveBeenCalledWith(['cover-a.jpg', 'cover-b.jpg', 'cover-c.jpg'], 900)
    expect(single).toHaveBeenCalledTimes(2)
    expect(single).toHaveBeenCalledWith('cover-b.jpg', 900)
    expect(single).toHaveBeenCalledWith('cover-c.jpg', 900)
    expect([...result.entries()]).toEqual([
      ['couple-media:cover-a.jpg', 'https://batch.example/a'],
      ['couple-media:cover-b.jpg', 'https://single.example/b'],
    ])
  })

  it.each(['rejection', 'error response'] as const)('uses direct single signing after a batch %s', async failure => {
    const batch = vi.fn<BatchSigner>(async () => {
      if (failure === 'rejection') throw new Error('batch unavailable')
      return { data: null, error: new Error('batch denied') }
    })
    const { client, createSignedUrl } = signingClient({ createSignedUrls: batch })
    const result = await createPrivateMediaSignedUrls(client, [{ path: 'cover.jpg' }], 120)

    expect(createSignedUrl).toHaveBeenCalledExactlyOnceWith('cover.jpg', 120)
    expect(result.get('couple-media:cover.jpg')).toBe('https://signed.example/cover.jpg')
  })

  it('rechecks the current SDK session on every call without browser cache access', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const openCache = vi.fn()
    const fetchMock = vi.fn()
    vi.stubGlobal('caches', { open: openCache })
    vi.stubGlobal('fetch', fetchMock)
    let activeUser = 'first-user'
    const batch = vi.fn<BatchSigner>(async paths => ({
      data: paths.map(path => ({ path, signedUrl: `https://signed.example/${activeUser}` })), error: null,
    }))
    const { client } = signingClient({ createSignedUrls: batch })
    const first = await createPrivateMediaSignedUrls(client, [{ path: 'same-cover.jpg' }])
    activeUser = 'second-user'
    const second = await createPrivateMediaSignedUrls(client, [{ path: 'same-cover.jpg' }])

    expect(first.get('couple-media:same-cover.jpg')).toBe('https://signed.example/first-user')
    expect(second.get('couple-media:same-cover.jpg')).toBe('https://signed.example/second-user')
    expect(batch).toHaveBeenCalledTimes(2)
    expect(getItem).not.toHaveBeenCalled()
    expect(setItem).not.toHaveBeenCalled()
    expect(openCache).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('bounds single-request concurrency and tolerates an unavailable bucket', async () => {
    let active = 0
    let peak = 0
    const single = vi.fn<SigningApi['createSignedUrl']>(async path => {
      active += 1; peak = Math.max(peak, active)
      await Promise.resolve()
      active -= 1
      return { data: { signedUrl: `https://single.example/${path}` }, error: null }
    })
    const { client, from } = signingClient({ createSignedUrl: single })
    const normalFrom = from.getMockImplementation()!
    from.mockImplementation(bucket => { if (bucket === 'unavailable') throw new Error('unavailable'); return normalFrom(bucket) })
    const result = await createPrivateMediaSignedUrls(client, [
      ...Array.from({ length: 13 }, (_, index) => ({ path: `cover-${index}.jpg` })),
      { path: 'hidden.jpg', bucket: 'unavailable' },
    ])

    expect(result.size).toBe(13)
    expect(peak).toBeLessThanOrEqual(4)
    expect(result.has('unavailable:hidden.jpg')).toBe(false)
  })

  it('returns an empty result for absent configuration or no usable paths', async () => {
    const { client, from } = signingClient()
    expect(await createPrivateMediaSignedUrls(null, [{ path: 'cover.jpg' }])).toEqual(new Map())
    expect(await createPrivateMediaSignedUrls(undefined, [])).toEqual(new Map())
    expect(await createPrivateMediaSignedUrls(client, [{ path: '' }])).toEqual(new Map())
    expect(from).not.toHaveBeenCalled()
  })
})
