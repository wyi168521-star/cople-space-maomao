export type QueryStatus = 'idle' | 'pending' | 'success' | 'error' | 'unconfigured'

export type RealtimeStatus = 'idle' | 'connecting' | 'subscribed' | 'closed' | 'error' | 'unconfigured'

/** 同时兼容 Supabase PostgREST 与 RPC 的响应。 */
export type SupabaseQueryResult<T> = {
  data: T | null
  error: { message: string } | null
  count?: number | null
}
