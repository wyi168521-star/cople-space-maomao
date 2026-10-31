import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, shallowRef, type App } from 'vue'
import { useSupabaseQuery } from '../app/composables/useSupabaseQuery'
import { useRealtime, type RealtimeFilter } from '../app/composables/useRealtime'
import type { SupabaseQueryResult } from '../app/types/shared'

const mounted: Array<{ app: App; host: HTMLElement }> = []

function mountComposable<T>(setup: () => T) {
  let result!: T
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({ setup() { result = setup(); return () => h('div') } })
  app.mount(host)
  mounted.push({ app, host })
  return { result, unmount: () => app.unmount() }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => vi.stubGlobal('useNuxtApp', () => ({ $supabase: {} })))
afterEach(() => {
  for (const { app, host } of mounted.splice(0)) { if (host.hasChildNodes()) app.unmount(); host.remove() }
  vi.unstubAllGlobals()
})

describe('useSupabaseQuery', () => {
  it('aborts superseded requests and never replaces newer data with an older response', async () => {
    const first = deferred<SupabaseQueryResult<string>>()
    const second = deferred<SupabaseQueryResult<string>>()
    const signals: AbortSignal[] = []
    const query = vi.fn((_client, signal: AbortSignal) => {
      signals.push(signal)
      return signals.length === 1 ? first.promise : second.promise
    })
    const { result } = mountComposable(() => useSupabaseQuery(query, { immediate: false }))
    const oldRequest = result.execute()
    const newRequest = result.execute()
    expect(signals[0]?.aborted).toBe(true)
    second.resolve({ data: 'new', error: null })
    await newRequest
    first.resolve({ data: 'old', error: null })
    await oldRequest
    expect(result.data.value).toBe('new')
    expect(result.status.value).toBe('success')
  })

  it('cancels pending work on unmount and ignores a late response', async () => {
    const request = deferred<SupabaseQueryResult<string>>()
    let signal!: AbortSignal
    const { result, unmount } = mountComposable(() => useSupabaseQuery((_client, currentSignal) => {
      signal = currentSignal
      return request.promise
    }, { immediate: false }))
    const pending = result.execute()
    unmount()
    expect(signal.aborted).toBe(true)
    request.resolve({ data: 'too late', error: null })
    await pending
    expect(result.data.value).toBeNull()
  })

  it('does not query when disabled or missing configuration, and reports SDK errors', async () => {
    const enabled = shallowRef(false)
    const query = vi.fn(async () => ({ data: null, error: { message: 'access denied' } }))
    const { result } = mountComposable(() => useSupabaseQuery(query, { enabled }))
    expect(query).not.toHaveBeenCalled()
    enabled.value = true
    await nextTick()
    await expect.poll(() => result.status.value).toBe('error')
    expect(result.error.value?.message).toBe('access denied')
    vi.stubGlobal('useNuxtApp', () => ({ $supabase: null }))
    const missing = mountComposable(() => useSupabaseQuery(query)).result
    expect(missing.status.value).toBe('unconfigured')
    const callCount = query.mock.calls.length
    await missing.refresh()
    expect(query).toHaveBeenCalledTimes(callCount)
  })
})

function realtimeClient() {
  const channels: Array<{
    name: string
    handle?: (payload: unknown) => void
    status?: (status: string) => void
    on: ReturnType<typeof vi.fn>
    subscribe: ReturnType<typeof vi.fn>
  }> = []
  const client = {
    channel: vi.fn((name: string) => {
      const channel = {
        name,
        handle: undefined as ((payload: unknown) => void) | undefined,
        status: undefined as ((status: string) => void) | undefined,
        on: vi.fn((_event, _filter, callback) => { channel.handle = callback; return channel }),
        subscribe: vi.fn(callback => { channel.status = callback; return channel }),
      }
      channels.push(channel)
      return channel
    }),
    removeChannel: vi.fn(async () => 'ok'),
  }
  return { client, channels }
}

describe('useRealtime', () => {
  it('keeps callbacks fresh, replaces filtered channels and cleans up on unmount', async () => {
    const { client, channels } = realtimeClient()
    vi.stubGlobal('useNuxtApp', () => ({ $supabase: client }))
    const filter = shallowRef<RealtimeFilter>({ event: '*', schema: 'public', table: 'memories', filter: 'couple_id=eq.first' })
    const oldCallback = vi.fn()
    const newCallback = vi.fn()
    const callback = shallowRef(oldCallback)
    const { result, unmount } = mountComposable(() => useRealtime(filter, callback, { immediate: false }))
    await result.subscribe()
    channels[0]?.status?.('SUBSCRIBED')
    expect(result.connected.value).toBe(true)
    callback.value = newCallback
    channels[0]?.handle?.({ eventType: 'INSERT', new: { id: 'one' } })
    expect(oldCallback).not.toHaveBeenCalled()
    expect(newCallback).toHaveBeenCalledOnce()

    filter.value = { ...filter.value, filter: 'couple_id=eq.second' }
    await nextTick()
    await expect.poll(() => channels.length).toBe(2)
    expect(client.removeChannel).toHaveBeenCalledWith(channels[0])
    channels[0]?.status?.('CHANNEL_ERROR')
    channels[0]?.handle?.({ eventType: 'INSERT', new: { id: 'stale' } })
    expect(newCallback).toHaveBeenCalledOnce()
    expect(result.status.value).toBe('connecting')
    unmount()
    expect(client.removeChannel).toHaveBeenCalledWith(channels[1])
  })

  it('uses distinct names for two consumers and skips unconfigured connections', async () => {
    const { client, channels } = realtimeClient()
    vi.stubGlobal('useNuxtApp', () => ({ $supabase: client }))
    const filter: RealtimeFilter = { event: '*', schema: 'public', table: 'memories' }
    const first = mountComposable(() => useRealtime(filter, vi.fn(), { channelName: 'shared', immediate: false })).result
    const second = mountComposable(() => useRealtime(filter, vi.fn(), { channelName: 'shared', immediate: false })).result
    await Promise.all([first.subscribe(), second.subscribe()])
    expect(channels[0]?.name).not.toBe(channels[1]?.name)
    vi.stubGlobal('useNuxtApp', () => ({ $supabase: null }))
    const missing = mountComposable(() => useRealtime(filter, vi.fn())).result
    await missing.subscribe()
    expect(missing.status.value).toBe('unconfigured')
    expect(channels).toHaveLength(2)
  })
})
