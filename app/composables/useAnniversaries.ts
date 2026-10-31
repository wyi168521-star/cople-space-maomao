import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Database } from '../types/database.generated'
import { beijingDate, calendarDaysUntil, isCalendarDate, nextAnniversaryDate, untilNextBeijingDay } from '../utils/anniversaryDates'

// 保留旧组件使用的字段名；数据源统一读取 target_date / repeat_yearly。
export type AnniversaryKind = 'anniversary' | 'birthday' | 'travel' | 'custom'
export type Anniversary = { id: string; title: string; eventDate: string; kind: AnniversaryKind; recurring: boolean; note: string; createdBy: string }
type AnniversaryRow = Database['public']['Tables']['anniversaries']['Row']
type AnniversaryInput = { title: string; targetDate?: string; repeatYearly?: boolean; eventDate?: string; recurring?: boolean; kind?: AnniversaryKind; note?: string }

export function occurrence(event: Anniversary) {
  const value = nextAnniversaryDate(event.eventDate, event.recurring, beijingDate()) || event.eventDate
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(0)
  date.setFullYear(year!, month! - 1, day!)
  date.setHours(12, 0, 0, 0)
  return date
}

export function daysUntil(event: Anniversary) {
  const today = beijingDate()
  const next = nextAnniversaryDate(event.eventDate, event.recurring, today)
  return calendarDaysUntil(next || event.eventDate, today)
}

function mapRow(row: AnniversaryRow): Anniversary {
  return { id: row.id, title: row.title, eventDate: row.target_date, recurring: row.repeat_yearly,
    kind: row.kind as AnniversaryKind, note: row.note || '', createdBy: row.created_by }
}

export function useAnniversaries() {
  const { $supabase } = useNuxtApp()
  const { user, profile, demoMode } = useAuth()
  const anniversaries = useState<Anniversary[]>('love:anniversaries', () => [])
  const relationshipStart = useState('love:relationship-start', () => profile.value?.startDate || '')
  const anniversariesLoading = ref(false)
  const errorMessage = ref('')
  const today = ref(beijingDate())
  const identity = computed(() => `${user.value?.id || ''}:${profile.value?.coupleId || ''}:${demoMode.value}`)
  const stateOwner = useState('love:anniversaries-owner', () => identity.value)
  if (stateOwner.value !== identity.value) {
    stateOwner.value = identity.value
    anniversaries.value = []
    relationshipStart.value = profile.value?.startDate || ''
  }
  let generation = 0
  let request: AbortController | undefined
  let pending: Promise<void> | undefined
  let clock: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  const upcoming = computed(() => anniversaries.value.flatMap(event => {
    const nextDate = nextAnniversaryDate(event.eventDate, event.recurring, today.value)
    return nextDate ? [{ ...event, nextDate, daysRemaining: calendarDaysUntil(nextDate, today.value) }] : []
  }).sort((a, b) => a.nextDate.localeCompare(b.nextDate) || a.id.localeCompare(b.id)))
  const sorted = computed(() => upcoming.value)
  const nextAnniversary = computed(() => upcoming.value[0] || null)
  const todayAnniversaries = computed(() => upcoming.value.filter(event => event.daysRemaining === 0))
  const loveDays = computed(() => isCalendarDate(relationshipStart.value)
    ? Math.max(1, calendarDaysUntil(today.value, relationshipStart.value) + 1) : 0)
  const messageOf = (error: unknown) => error && typeof error === 'object' && 'message' in error ? String(error.message) : '读取纪念日失败，请稍后重试。'

  function context() {
    const coupleId = profile.value?.coupleId
    const userId = user.value?.id
    if (!coupleId || !userId) throw new Error('请先登录并加入情侣空间。')
    return { coupleId, userId, generation }
  }
  const isCurrent = (state: ReturnType<typeof context>) => !disposed && generation === state.generation
    && profile.value?.coupleId === state.coupleId && user.value?.id === state.userId

  function loadAnniversaries(): Promise<void> {
    if (disposed || !import.meta.client) return Promise.resolve()
    if (pending) return pending
    const task = (async () => {
      anniversariesLoading.value = true
      errorMessage.value = ''
      const version = generation
      try {
        if (demoMode.value) {
          anniversaries.value = JSON.parse(localStorage.getItem('couple-space-anniversaries') || '[]')
          relationshipStart.value = localStorage.getItem('couple-space-start') || '2023-01-02'
          return
        }
        if (!$supabase) throw new Error('数据库连接尚未配置。')
        const state = context()
        const controller = new AbortController()
        request = controller
        const couple = await $supabase.from('couples').select('start_date').eq('id', state.coupleId).abortSignal(controller.signal).single()
        if (!isCurrent(state)) return
        if (couple.error) throw couple.error
        const result: AnniversaryRow[] = []
        for (let offset = 0; ; offset += 200) {
          const { data, error } = await $supabase.from('anniversaries').select('*').eq('couple_id', state.coupleId)
            .order('target_date', { ascending: true }).order('id', { ascending: true })
            .range(offset, offset + 199).abortSignal(controller.signal)
          if (!isCurrent(state)) return
          if (error) throw error
          result.push(...(data || []))
          if (!data || data.length < 200) break
        }
        relationshipStart.value = couple.data.start_date
        anniversaries.value = result.map(mapRow)
      } catch (error) {
        if (!disposed && version === generation) errorMessage.value = messageOf(error)
      } finally {
        if (!disposed && version === generation) { anniversariesLoading.value = false; request = undefined }
      }
    })()
    pending = task
    void task.finally(() => { if (pending === task) pending = undefined })
    return task
  }

  function validate(input: AnniversaryInput) {
    const title = input.title.trim()
    const date = input.targetDate ?? input.eventDate ?? ''
    if (!title) throw new Error('请填写纪念日名称。')
    if ([...title].length > 80) throw new Error('纪念日名称最多 80 个字。')
    if (!isCalendarDate(date)) throw new Error('请选择有效的纪念日日期。')
    if ([...(input.note || '')].length > 300) throw new Error('备注最多 300 个字。')
    return { title, date, repeat: input.repeatYearly ?? input.recurring ?? true }
  }
  function saveDemo() { localStorage.setItem('couple-space-anniversaries', JSON.stringify(anniversaries.value)) }

  async function createAnniversary(input: AnniversaryInput) {
    const value = validate(input)
    if (demoMode.value) {
      const id = `demo-${Date.now()}-${Math.random().toString(16).slice(2)}`
      anniversaries.value.push({ id, title: value.title, eventDate: value.date, recurring: value.repeat,
        kind: input.kind || 'anniversary', note: input.note?.trim() || '', createdBy: profile.value?.id || 'demo-user' })
      saveDemo()
      return id
    }
    if (!$supabase) throw new Error('数据库连接尚未配置。')
    const state = context()
    const { data, error } = await $supabase.from('anniversaries').insert({
      couple_id: state.coupleId, created_by: state.userId, title: value.title,
      target_date: value.date, event_date: value.date, repeat_yearly: value.repeat, recurring: value.repeat,
      kind: input.kind || 'anniversary', note: input.note?.trim() || null,
    }).select('*').single()
    if (error) throw new Error(messageOf(error))
    if (isCurrent(state)) anniversaries.value = [...anniversaries.value.filter(item => item.id !== data.id), mapRow(data)]
    return data.id
  }

  async function updateAnniversary(id: string, input: Partial<Anniversary>) {
    const existing = anniversaries.value.find(item => item.id === id)
    if (!existing) throw new Error('找不到这个纪念日，请刷新后重试。')
    const merged = { ...existing, ...input }
    const value = validate(merged)
    if (demoMode.value) { anniversaries.value = anniversaries.value.map(item => item.id === id ? merged : item); saveDemo(); return }
    if (!$supabase) throw new Error('数据库连接尚未配置。')
    const state = context()
    const { data, error } = await $supabase.from('anniversaries').update({
      title: value.title, target_date: value.date, event_date: value.date,
      repeat_yearly: value.repeat, recurring: value.repeat, kind: merged.kind, note: merged.note.trim() || null,
    }).eq('id', id).eq('couple_id', state.coupleId).select('*').single()
    if (error) throw new Error(messageOf(error))
    if (isCurrent(state)) anniversaries.value = anniversaries.value.map(item => item.id === id ? mapRow(data) : item)
  }

  async function deleteAnniversary(item: Anniversary) {
    if (demoMode.value) { anniversaries.value = anniversaries.value.filter(row => row.id !== item.id); saveDemo(); return }
    if (!$supabase) throw new Error('数据库连接尚未配置。')
    const state = context()
    const { data, error } = await $supabase.from('anniversaries').delete().eq('id', item.id).eq('couple_id', state.coupleId).select('id')
    if (error) throw new Error(messageOf(error))
    if (!data?.length) throw new Error('只有创建者可以删除这个纪念日。')
    if (isCurrent(state)) anniversaries.value = anniversaries.value.filter(row => row.id !== item.id)
  }

  function tick() {
    today.value = beijingDate()
    if (clock) clearTimeout(clock)
    clock = setTimeout(tick, untilNextBeijingDay())
  }
  function onVisible() { if (document.visibilityState === 'visible') tick() }
  watch(identity, () => {
    generation++; request?.abort(); pending = undefined
    anniversariesLoading.value = false
    stateOwner.value = identity.value
    anniversaries.value = []; relationshipStart.value = profile.value?.startDate || ''; errorMessage.value = ''
    if (profile.value?.coupleId || demoMode.value) void loadAnniversaries()
  }, { flush: 'sync' })
  onMounted(() => { tick(); document.addEventListener('visibilitychange', onVisible); void loadAnniversaries() })
  onBeforeUnmount(() => { disposed = true; generation++; request?.abort(); if (clock) clearTimeout(clock); document.removeEventListener('visibilitychange', onVisible) })

  return { anniversaries, relationshipStart, loveDays, sorted, nextAnniversary, todayAnniversaries, today,
    anniversariesLoading, errorMessage, loadAnniversaries, createAnniversary, updateAnniversary, deleteAnniversary }
}
