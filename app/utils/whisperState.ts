import type { Database } from '../types/database.generated'

export type Whisper = Database['public']['Tables']['whispers']['Row']

function timestampKey(value: string) {
  // 保留 Postgres 微秒精度，避免同一毫秒内的消息被 UUID 顺序打乱。
  const fraction = value.match(/\.(\d+)/)?.[1] || ''
  return `${new Date(value).toISOString().slice(0, 19)}.${fraction.padEnd(6, '0').slice(0, 6)}`
}

export function newerReadAt(a: string | null, b: string | null) {
  if (!a) return b
  if (!b) return a
  return timestampKey(a) >= timestampKey(b) ? a : b
}

export function mergeWhispers(current: Whisper[], incoming: Whisper[]) {
  const rows = new Map(current.map(row => [row.id, row]))
  for (const row of incoming) {
    const previous = rows.get(row.id)
    rows.set(row.id, previous ? { ...previous, ...row, read_at: newerReadAt(previous.read_at, row.read_at) } : row)
  }
  return [...rows.values()].sort((a, b) => {
    const left = timestampKey(a.created_at)
    const right = timestampKey(b.created_at)
    return left === right ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : left < right ? -1 : 1
  })
}

export function whisperMessageId() {
  if (typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID()
  // HTTP 局域网地址没有 randomUUID，但仍支持 getRandomValues。
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
