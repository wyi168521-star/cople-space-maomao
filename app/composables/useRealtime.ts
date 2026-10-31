import type {
  RealtimeChannel, RealtimePostgresChangesFilter, RealtimePostgresChangesPayload,
} from '@supabase/supabase-js'
import {
  computed, getCurrentScope, onMounted, onScopeDispose, readonly, shallowRef, toValue, unref, watch,
  type MaybeRef, type MaybeRefOrGetter,
} from 'vue'
import type { RealtimeStatus } from '../types/shared'

export type RealtimeFilter = RealtimePostgresChangesFilter<'*' | 'INSERT' | 'UPDATE' | 'DELETE'>

export type RealtimeOptions = {
  channelName?: string
  immediate?: boolean
  enabled?: MaybeRefOrGetter<boolean>
}

/** 每个调用独享频道。回调可以是 ref，收到事件时始终读取最新回调。 */
export function useRealtime<TRow extends Record<string, unknown> = Record<string, unknown>>(
  filter: MaybeRefOrGetter<RealtimeFilter>,
  onChange: MaybeRef<(payload: RealtimePostgresChangesPayload<TRow>) => void>,
  options: RealtimeOptions = {},
) {
  const { $supabase } = useNuxtApp()
  const configured = computed(() => Boolean($supabase))
  const enabled = computed(() => toValue(options.enabled ?? true))
  const status = shallowRef<RealtimeStatus>($supabase ? 'idle' : 'unconfigured')
  const error = shallowRef<Error | null>(null)
  const connected = computed(() => status.value === 'subscribed')
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  const channelName = `${options.channelName ?? 'postgres-changes'}:${suffix}`
  let channel: RealtimeChannel | null = null
  let generation = 0
  let mounted = false
  let disposed = false

  async function removeChannel(current: RealtimeChannel | null) {
    if (!current || !$supabase) return
    try { await $supabase.removeChannel(current) } catch { /* 清理失败不阻止页面离开。 */ }
  }

  async function stop() {
    generation += 1
    const previous = channel
    channel = null
    status.value = $supabase ? 'idle' : 'unconfigured'
    error.value = null
    await removeChannel(previous)
  }

  async function subscribe() {
    if (disposed || import.meta.server || typeof window === 'undefined') return
    const currentGeneration = ++generation
    const previous = channel
    channel = null
    await removeChannel(previous)
    if (disposed || generation !== currentGeneration) return

    error.value = null
    if (!$supabase) { status.value = 'unconfigured'; return }
    if (!enabled.value) { status.value = 'idle'; return }
    status.value = 'connecting'

    try {
      const current = $supabase.channel(channelName)
      channel = current
      const resolvedFilter = toValue(filter)
      const handleChange = (payload: RealtimePostgresChangesPayload<TRow>) => {
        if (disposed || generation !== currentGeneration || channel !== current || !enabled.value) return
        unref(onChange)(payload)
      }

      // 保持 SDK 各事件重载的类型推导，不使用 any 强制绕过动态 event 类型。
      switch (resolvedFilter.event) {
        case 'INSERT': current.on<TRow>('postgres_changes', { ...resolvedFilter, event: 'INSERT' }, handleChange); break
        case 'UPDATE': current.on<TRow>('postgres_changes', { ...resolvedFilter, event: 'UPDATE' }, handleChange); break
        case 'DELETE': current.on<TRow>('postgres_changes', { ...resolvedFilter, event: 'DELETE' }, handleChange); break
        default: current.on<TRow>('postgres_changes', { ...resolvedFilter, event: '*' }, handleChange)
      }

      current.subscribe((nextStatus, cause) => {
        if (disposed || generation !== currentGeneration || channel !== current) return
        if (nextStatus === 'SUBSCRIBED') { status.value = 'subscribed'; error.value = null }
        else if (nextStatus === 'CLOSED') status.value = 'closed'
        else if (nextStatus === 'CHANNEL_ERROR' || nextStatus === 'TIMED_OUT') {
          status.value = 'error'
          error.value = cause ?? new Error(nextStatus === 'TIMED_OUT' ? '实时连接超时' : '实时连接失败')
        }
      })
    } catch (cause) {
      if (disposed || generation !== currentGeneration) return
      const failedChannel = channel
      channel = null
      status.value = 'error'
      error.value = cause instanceof Error ? cause : new Error(String(cause))
      await removeChannel(failedChannel)
    }
  }

  watch([enabled, () => toValue(filter)], () => {
    if (!mounted || disposed) return
    if (enabled.value) void subscribe()
    else void stop()
  }, { deep: true })

  onMounted(() => {
    mounted = true
    if (options.immediate !== false && enabled.value) void subscribe()
  })

  if (getCurrentScope()) {
    onScopeDispose(() => {
      disposed = true
      void stop()
    })
  }

  return { configured, connected, status: readonly(status), error: readonly(error), subscribe, stop }
}
