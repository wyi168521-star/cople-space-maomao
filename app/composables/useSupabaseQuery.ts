import type { AppSupabaseClient } from '../lib/supabase'
import {
  computed, getCurrentScope, onMounted, onScopeDispose, readonly, shallowRef, toValue, watch,
  type MaybeRefOrGetter, type WatchSource,
} from 'vue'
import type { QueryStatus, SupabaseQueryResult } from '../types/shared'

export type SupabaseQuery<T> = (client: AppSupabaseClient, signal: AbortSignal) => PromiseLike<SupabaseQueryResult<T>>

export type SupabaseQueryOptions<T> = {
  initialData?: T
  immediate?: boolean
  enabled?: MaybeRefOrGetter<boolean>
  watch?: WatchSource | WatchSource[]
}

function queryError(value: unknown): Error {
  if (value instanceof Error) return value
  if (value && typeof value === 'object' && 'message' in value) return new Error(String(value.message))
  return new Error(typeof value === 'string' ? value : '请求失败，请稍后重试')
}

/**
 * 在组件挂载后查询，不会自动发起 SSR 请求。
 * 将 signal 传给 PostgREST 的 .abortSignal(signal) 可取消网络；即使未传，旧响应也会被丢弃。
 */
export function useSupabaseQuery<T>(query: SupabaseQuery<T>, options: SupabaseQueryOptions<T> = {}) {
  const { $supabase } = useNuxtApp()
  const configured = computed(() => Boolean($supabase))
  const enabled = computed(() => toValue(options.enabled ?? true))
  const data = shallowRef<T | null>(options.initialData ?? null)
  const error = shallowRef<Error | null>(null)
  const count = shallowRef<number | null>(null)
  const status = shallowRef<QueryStatus>($supabase ? 'idle' : 'unconfigured')
  const pending = computed(() => status.value === 'pending')
  let controller: AbortController | null = null
  let generation = 0
  let mounted = false
  let disposed = false

  function cancel() {
    generation += 1
    controller?.abort()
    controller = null
    status.value = $supabase ? 'idle' : 'unconfigured'
    error.value = null
  }

  async function execute(): Promise<T | null> {
    if (disposed) return null
    cancel()
    if (!$supabase || !enabled.value || import.meta.server || typeof window === 'undefined') return null

    const currentGeneration = generation
    const currentController = new AbortController()
    controller = currentController
    status.value = 'pending'

    try {
      const result = await query($supabase, currentController.signal)
      if (disposed || generation !== currentGeneration) return null
      if (result.error) throw result.error
      data.value = result.data
      count.value = result.count ?? null
      status.value = 'success'
      return result.data
    } catch (cause) {
      if (disposed || generation !== currentGeneration) return null
      error.value = queryError(cause)
      status.value = 'error'
      return null
    } finally {
      if (generation === currentGeneration) controller = null
    }
  }

  function clear() {
    cancel()
    data.value = options.initialData ?? null
    count.value = null
  }

  const watchSources = options.watch ? (Array.isArray(options.watch) ? options.watch : [options.watch]) : []
  watch([enabled, ...watchSources], () => {
    if (!mounted || disposed) return
    if (enabled.value) void execute()
    else cancel()
  })

  onMounted(() => {
    mounted = true
    if (options.immediate !== false && enabled.value) void execute()
  })

  if (getCurrentScope()) {
    onScopeDispose(() => {
      disposed = true
      cancel()
    })
  }

  return {
    data: readonly(data), error: readonly(error), count: readonly(count), status: readonly(status),
    configured, pending, execute, refresh: execute, cancel, clear,
  }
}
