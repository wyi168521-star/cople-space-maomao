import { afterEach, describe, expect, it, vi } from 'vitest'
import { mergeWhispers, whisperMessageId, type Whisper } from '../app/utils/whisperState'

const row = (overrides: Partial<Whisper> = {}): Whisper => ({
  id: '00000000-0000-4000-8000-000000000001', couple_id: 'space', sender_id: 'a', body: 'hello',
  created_at: '2026-10-30T08:00:00.123456+00:00', read_at: null, media_path: null, media_type: null,
  ...overrides,
})

afterEach(() => vi.unstubAllGlobals())

describe('whisper delivery state', () => {
  it('deduplicates HTTP and realtime delivery without reverting an earlier read receipt', () => {
    const read = '2026-10-30T08:00:02.000001+00:00'
    const realtime = row({ read_at: read })
    const snapshot = row()
    const merged = mergeWhispers([realtime], [snapshot, snapshot])
    expect(merged).toHaveLength(1)
    expect(merged[0]?.read_at).toBe(read)
    expect(snapshot.read_at).toBeNull()
  })

  it('orders by microseconds before UUID, even across timestamp timezone formats', () => {
    const earlier = row({ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', created_at: '2026-10-30T08:00:00.123001Z' })
    const later = row({ created_at: '2026-10-30T16:00:00.123999+08:00' })
    expect(mergeWhispers([later], [earlier]).map(message => message.id)).toEqual([earlier.id, later.id])
  })

  it('uses UUID as a stable tie breaker and never downgrades to an older read timestamp', () => {
    const first = row()
    const second = row({ id: '00000000-0000-4000-8000-000000000002', read_at: '2026-10-30T08:01:01Z' })
    const merged = mergeWhispers([second], [first, { ...second, read_at: '2026-10-30T08:01:00Z' }])
    expect(merged.map(message => message.id)).toEqual([first.id, second.id])
    expect(merged[1]?.read_at).toBe(second.read_at)
  })

  it('creates distinct RFC4122 UUIDs on LAN HTTP without crypto.randomUUID', () => {
    const original = globalThis.crypto
    vi.stubGlobal('crypto', { getRandomValues: original.getRandomValues.bind(original) })
    const ids = Array.from({ length: 100 }, whisperMessageId)
    expect(new Set(ids).size).toBe(100)
    expect(ids.every(id => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))).toBe(true)
  })
})
