import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

export type DashboardKey = 'memories' | 'whispers' | 'photos' | 'wishes'
type Metric = { count: number | null; loading: boolean; error: string }
const keys: DashboardKey[] = ['memories', 'whispers', 'photos', 'wishes']
const emptyStats = (loading = false): Record<DashboardKey, Metric> => ({
  memories: { count: null, loading, error: '' }, whispers: { count: null, loading, error: '' },
  photos: { count: null, loading, error: '' }, wishes: { count: null, loading, error: '' },
})

/** HEAD + exact count：只接收总数，不下载聊天、回忆或照片列表。 */
export function useDashboard() {
  const { $supabase } = useNuxtApp()
  const { user, profile } = useAuth()
  const stats = ref(emptyStats(true))
  const loading = computed(() => keys.some(key => stats.value[key].loading))
  let mounted = false
  let version = 0
  let request: AbortController | undefined

  function invalidate() {
    version++
    request?.abort()
    request = undefined
  }

  function exactCount(result: { count: number | null; error: { message: string } | null; status?: number }) {
    // HEAD 出错时响应体可能为空，仍要提供可见错误，不能伪装成 0 或成功。
    if (result.error) throw new Error(result.error.message || `统计请求失败（HTTP ${result.status || '未知'}）。`)
    if (result.count === null || !Number.isSafeInteger(result.count) || result.count < 0) {
      throw new Error('服务没有返回有效的统计数量。')
    }
    return result.count
  }

  async function refresh() {
    if (!mounted) return
    invalidate()
    stats.value = emptyStats()
    const client = $supabase
    const userId = user.value?.id
    const coupleId = profile.value?.coupleId
    if (!userId || !coupleId) return
    if (!client) {
      keys.forEach(key => { stats.value[key].error = '数据库连接尚未配置。' })
      return
    }

    const currentVersion = version
    const controller = new AbortController()
    request = controller
    const active = () => mounted && currentVersion === version
      && user.value?.id === userId && profile.value?.coupleId === coupleId
    stats.value = emptyStats(true)
    const signal = controller.signal
    const queries: Record<DashboardKey, () => Promise<number>> = {
      memories: async () => exactCount(await client.from('memories')
        .select('id', { count: 'exact', head: true }).eq('couple_id', coupleId).abortSignal(signal)),
      whispers: async () => exactCount(await client.from('whispers')
        .select('id', { count: 'exact', head: true }).eq('couple_id', coupleId).abortSignal(signal)),
      photos: async () => {
        // 媒体表没有 couple_id，必须通过父表过滤；只统计照片，排除视频。
        const [album, memory] = await Promise.all([
          client.from('album_media').select('id,albums!inner(couple_id)', { count: 'exact', head: true })
            .eq('albums.couple_id', coupleId).eq('media_type', 'photo').abortSignal(signal),
          client.from('memory_media').select('id,memories!inner(couple_id)', { count: 'exact', head: true })
            .eq('memories.couple_id', coupleId).eq('media_type', 'photo').abortSignal(signal),
        ])
        return exactCount(album) + exactCount(memory)
      },
      wishes: async () => exactCount(await client.from('wishes')
        .select('id', { count: 'exact', head: true }).eq('couple_id', coupleId)
        .eq('is_completed', true).abortSignal(signal)),
    }

    // 各项独立结算；一项失败仍可展示其他项，失败不会被误报为 0。
    await Promise.allSettled(keys.map(async key => {
      try {
        const count = await queries[key]()
        if (active()) stats.value[key].count = count
      } catch (error) {
        if (active()) stats.value[key].error = error && typeof error === 'object' && 'message' in error
          ? String(error.message || '暂时无法读取，请稍后重试。') : '暂时无法读取，请稍后重试。'
      } finally {
        if (active()) stats.value[key].loading = false
      }
    }))
    if (active()) request = undefined
  }

  watch([() => user.value?.id, () => profile.value?.coupleId], () => {
    invalidate()
    stats.value = emptyStats(mounted && !!user.value?.id && !!profile.value?.coupleId)
    if (mounted) void refresh()
  }, { flush: 'sync' })
  onMounted(() => { mounted = true; void refresh() })
  onBeforeUnmount(() => { mounted = false; invalidate() })

  return { stats, loading, refresh }
}
