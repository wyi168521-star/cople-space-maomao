import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Database } from '../types/database.generated'

type MemoryRow = Database['public']['Tables']['memories']['Row']
type MemoryInsert = Database['public']['Tables']['memories']['Insert']
export type TimelineMemory = Pick<MemoryRow, 'id' | 'date' | 'title' | 'body' | 'location'>
export type NewMemory = { date: string; title: string; body: string; location: string }
type Cursor = Pick<TimelineMemory, 'date' | 'id'>

function messageOf(error: unknown) {
  return error && typeof error === 'object' && 'message' in error
    ? String(error.message)
    : '请求失败，请稍后重试。'
}

export function useMemoryTimeline() {
  const { $supabase } = useNuxtApp()
  const { profile, user } = useAuth()
  const coupleId = computed(() => profile.value?.coupleId)
  const identity = computed(() => `${user.value?.id || ''}:${coupleId.value || ''}`)
  const rows = ref<TimelineMemory[]>([])
  const loading = ref(false)
  const errorMessage = ref('')
  const hasMore = ref(true)
  const pageSize = 20
  let cursor: Cursor | null = null
  let generation = 0
  let request: AbortController | undefined

  async function loadMore() {
    if (!import.meta.client || loading.value || !hasMore.value) return
    if (!$supabase || !coupleId.value || !user.value) return

    const version = generation
    const controller = new AbortController()
    request = controller
    loading.value = true
    errorMessage.value = ''
    try {
      let query = $supabase.from('memories')
        .select('id,date,title,body,location')
        .eq('couple_id', coupleId.value)
        .order('date', { ascending: false })
        .order('id', { ascending: false })
        .limit(pageSize + 1)

      if (cursor) {
        query = query.or(`date.lt.${cursor.date},and(date.eq.${cursor.date},id.lt.${cursor.id})`)
      }
      const { data, error } = await query.abortSignal(controller.signal)
      if (version !== generation) return
      if (error) throw error

      const result = data || []
      const page = result.slice(0, pageSize)
      rows.value.push(...page)
      hasMore.value = result.length > pageSize
      const last = page.at(-1)
      if (last) cursor = { date: last.date, id: last.id }
    } catch (error) {
      if (version === generation) errorMessage.value = messageOf(error)
    } finally {
      if (version === generation) {
        loading.value = false
        request = undefined
      }
    }
  }

  async function refresh() {
    generation++
    request?.abort()
    request = undefined
    cursor = null
    rows.value = []
    loading.value = false
    hasMore.value = true
    errorMessage.value = ''
    await loadMore()
  }

  async function createMemory(input: NewMemory) {
    if (!$supabase) throw new Error('数据库连接尚未配置。')
    const authorId = user.value?.id
    const spaceId = coupleId.value
    if (!authorId || !spaceId) throw new Error('请先登录并加入情侣空间。')

    const title = input.title.trim()
    const body = input.body.trim()
    const location = input.location.trim()
    if (!title) throw new Error('请给这段回忆起一个标题。')
    if ([...title].length > 120) throw new Error('标题最多 120 个字。')
    if ([...body].length > 1000) throw new Error('正文最多 1000 个字。')
    if ([...location].length > 80) throw new Error('地点最多 80 个字。')
    const dateTime = Date.parse(`${input.date}T00:00:00Z`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !Number.isFinite(dateTime)
      || new Date(dateTime).toISOString().slice(0, 10) !== input.date) {
      throw new Error('请选择有效的回忆日期。')
    }

    const payload: Omit<MemoryInsert, 'content' | 'memory_date'> = {
      couple_id: spaceId,
      author_id: authorId,
      date: input.date,
      title,
      body: body || null,
      location: location || null,
    }
    // BEFORE INSERT 触发器补齐旧版必填字段 content / memory_date。
    // 生成类型不能表达触发器默认值；在写入边界断言，避免空正文被复制成标题。
    const { data, error } = await $supabase.from('memories')
      .insert(payload as MemoryInsert)
      .select('id')
      .single()
    if (error) throw new Error(messageOf(error))
    return data.id
  }

  watch(identity, () => { void refresh() }, { flush: 'sync' })
  onMounted(() => { void refresh() })
  onBeforeUnmount(() => { generation++; request?.abort() })

  return { rows, loading, errorMessage, hasMore, loadMore, refresh, createMemory }
}
