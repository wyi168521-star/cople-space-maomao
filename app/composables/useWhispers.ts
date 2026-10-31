import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { mergeWhispers, newerReadAt, whisperMessageId, type Whisper } from '../utils/whisperState'

export type { Whisper } from '../utils/whisperState'
type Cursor = Pick<Whisper, 'created_at' | 'id'>
type Room = { generation: number; coupleId: string; userId: string }
const columns = 'id,couple_id,sender_id,body,media_path,media_type,read_at,created_at'

export function useWhispers() {
  const { $supabase } = useNuxtApp()
  const { user, profile } = useAuth()
  const identity = computed(() => `${user.value?.id || ''}:${profile.value?.coupleId || ''}`)
  const messages = ref<Whisper[]>([])
  const loading = ref(false)
  const loadingOlder = ref(false)
  const hasOlder = ref(false)
  const sending = ref(false)
  const errorMessage = ref('')
  const sendError = ref('')
  const readError = ref('')
  const realtimeError = ref('')
  const connection = ref<'connecting' | 'connected' | 'offline'>('connecting')
  const activity = ref(0)
  const maxLength = 4000
  const pageSize = 50
  let mounted = false
  let generation = 0
  let historyVersion = 0
  let channelVersion = 0
  let channel: RealtimeChannel | null = null
  let cursor: Cursor | null = null
  let historyRequest: AbortController | undefined
  let sendRequest: AbortController | undefined
  let readRequest: AbortController | undefined
  let historyBuffer: Map<string, Whisper> | undefined
  let readTask: Promise<void> | undefined
  let readAgain = false
  let pendingSend: { id: string; body: string } | undefined
  const receipts = new Map<string, string>()

  const messageOf = (error: unknown) => error && typeof error === 'object' && 'message' in error
    ? String(error.message) : '网络暂时不可用，请稍后重试。'

  function room(): Room | undefined {
    const coupleId = profile.value?.coupleId
    const userId = user.value?.id
    return mounted && $supabase && coupleId && userId ? { generation, coupleId, userId } : undefined
  }
  const current = (context: Room) => mounted && context.generation === generation
    && context.coupleId === profile.value?.coupleId && context.userId === user.value?.id
  const visible = () => typeof document !== 'undefined' && document.visibilityState === 'visible'

  function withReceipts(rows: Whisper[]) {
    return rows.map(row => ({ ...row, read_at: newerReadAt(row.read_at, receipts.get(row.id) || null) }))
  }

  function applyReceipt(id: string, value: string | null) {
    if (!value) return
    receipts.set(id, newerReadAt(receipts.get(id) || null, value)!)
    messages.value = messages.value.map(row => row.id === id
      ? { ...row, read_at: newerReadAt(row.read_at, value) } : row)
  }

  function append(row: Whisper) {
    const isNew = !messages.value.some(message => message.id === row.id)
    historyBuffer?.set(row.id, row)
    messages.value = mergeWhispers(messages.value, withReceipts([row]))
    if (isNew) activity.value++
  }

  async function fetchPage(context: Room, controller: AbortController, before?: Cursor) {
    let query = $supabase!.from('whispers').select(columns)
      .eq('couple_id', context.coupleId)
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .limit(pageSize + 1)
    if (before) query = query.or(`created_at.lt.${before.created_at},and(created_at.eq.${before.created_at},id.lt.${before.id})`)
    const { data, error } = await query.abortSignal(controller.signal)
    if (error) throw error
    const rows = data || []
    const page = rows.slice(0, pageSize).reverse()
    const first = page[0]
    return { page, more: rows.length > pageSize, cursor: first ? { created_at: first.created_at, id: first.id } : null }
  }

  async function refresh() {
    const context = room()
    if (!context) return
    const version = ++historyVersion
    historyRequest?.abort()
    const controller = new AbortController()
    historyRequest = controller
    const buffer = new Map<string, Whisper>()
    historyBuffer = buffer
    loading.value = true
    loadingOlder.value = false
    errorMessage.value = ''
    try {
      const result = await fetchPage(context, controller)
      if (!current(context) || version !== historyVersion) return
      messages.value = mergeWhispers(withReceipts(result.page), withReceipts([...buffer.values()]))
      cursor = result.cursor
      hasOlder.value = result.more
    } catch (error) {
      if (current(context) && version === historyVersion) errorMessage.value = messageOf(error)
    } finally {
      if (current(context) && version === historyVersion) {
        loading.value = false
        historyRequest = undefined
        historyBuffer = undefined
      }
    }
  }

  async function loadOlder() {
    const context = room()
    if (!context || loading.value || loadingOlder.value || !hasOlder.value || !cursor) return false
    const version = historyVersion
    const controller = new AbortController()
    historyRequest = controller
    loadingOlder.value = true
    errorMessage.value = ''
    try {
      const result = await fetchPage(context, controller, cursor)
      if (!current(context) || version !== historyVersion) return false
      messages.value = mergeWhispers(messages.value, withReceipts(result.page))
      cursor = result.cursor
      hasOlder.value = result.more
      return true
    } catch (error) {
      if (current(context) && version === historyVersion) errorMessage.value = messageOf(error)
      return false
    } finally {
      if (current(context) && version === historyVersion) { loadingOlder.value = false; historyRequest = undefined }
    }
  }

  function markRead(): Promise<void> {
    const context = room()
    if (!context || !visible()) return Promise.resolve()
    if (readTask) { readAgain = true; return readTask }
    const task = (async () => {
      do {
        readAgain = false
        const controller = new AbortController()
        readRequest = controller
        try {
          const { data, error } = await $supabase!.from('whispers')
            .update({ read_at: new Date().toISOString() })
            .eq('couple_id', context.coupleId).neq('sender_id', context.userId).is('read_at', null)
            .select('id,read_at').abortSignal(controller.signal)
          if (!current(context)) return
          if (error) throw error
          readError.value = ''
          for (const row of data || []) applyReceipt(row.id, row.read_at)
        } catch (error) {
          if (current(context)) readError.value = `已读状态同步失败：${messageOf(error)}`
          return
        }
      } while (readAgain && current(context) && visible())
    })()
    readTask = task
    void task.finally(() => { if (readTask === task) { readTask = undefined; readRequest = undefined } })
    return task
  }

  async function send(text: string) {
    if (sending.value) return false
    const context = room()
    const body = text.trim()
    sendError.value = ''
    if (!context) { sendError.value = '请先登录并加入情侣空间。'; return false }
    if (!body) { sendError.value = '先写一点想说的话吧。'; return false }
    if ([...body].length > maxLength) { sendError.value = `消息最多 ${maxLength} 个字。`; return false }
    sending.value = true
    let id: string | undefined
    try {
      if (!pendingSend || pendingSend.body !== body) pendingSend = { id: whisperMessageId(), body }
      id = pendingSend.id
      const controller = new AbortController()
      sendRequest = controller
      const result = await $supabase!.from('whispers')
        .insert({ id, couple_id: context.coupleId, sender_id: context.userId, body })
        .select(columns).abortSignal(controller.signal).single()
      if (!current(context)) return false
      let saved = result.data
      if (result.error?.code === '23505') {
        // 响应丢失后的重试复用 UUID，读取已保存消息而不重复插入。
        const existing = await $supabase!.from('whispers').select(columns)
          .eq('id', id).eq('couple_id', context.coupleId).eq('sender_id', context.userId)
          .abortSignal(controller.signal).single()
        if (!current(context)) return false
        if (existing.error) throw existing.error
        saved = existing.data
      } else if (result.error) throw result.error
      if (!saved) throw new Error('未收到消息保存结果，请重试。')
      append(saved)
      pendingSend = undefined
      return true
    } catch (error) {
      if (!current(context)) return false
      if (id && messages.value.some(row => row.id === id)) { pendingSend = undefined; return true }
      sendError.value = `发送失败：${messageOf(error)}`
      return false
    } finally {
      if (current(context)) { sending.value = false; sendRequest = undefined }
    }
  }

  function removeChannel() {
    channelVersion++
    const previous = channel
    channel = null
    if (previous && $supabase) void $supabase.removeChannel(previous).catch(() => {})
  }

  function reconnect() {
    const context = room()
    if (!context) return
    removeChannel()
    const version = channelVersion
    connection.value = 'connecting'
    realtimeError.value = ''
    try {
      channel = $supabase!.channel('room_' + context.coupleId)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'whispers', filter: `couple_id=eq.${context.coupleId}` }, payload => {
          if (!current(context) || version !== channelVersion) return
          const row = payload.new as Whisper
          if (row.couple_id !== context.coupleId) return
          append(row)
          if (row.sender_id !== context.userId && !row.read_at) void markRead()
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'whispers', filter: `couple_id=eq.${context.coupleId}` }, payload => {
          if (!current(context) || version !== channelVersion) return
          const row = payload.new as Whisper
          if (row.couple_id === context.coupleId) applyReceipt(row.id, row.read_at)
        })
        .subscribe(status => {
          if (!current(context) || version !== channelVersion) return
          if (status === 'SUBSCRIBED') {
            connection.value = 'connected'
            realtimeError.value = ''
            void refresh() // 补齐初次连接、重连期间可能遗漏的消息。
            void markRead()
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            connection.value = 'offline'
            realtimeError.value = '实时连接暂时中断，重新连接后会同步消息。'
          }
        })
    } catch (error) {
      connection.value = 'offline'
      realtimeError.value = `实时连接失败：${messageOf(error)}`
    }
  }

  function resetRoom() {
    generation++
    historyVersion++
    historyRequest?.abort()
    sendRequest?.abort()
    readRequest?.abort()
    historyRequest = sendRequest = readRequest = undefined
    readTask = undefined
    readAgain = false
    historyBuffer = undefined
    pendingSend = undefined
    removeChannel()
    receipts.clear()
    messages.value = []
    loading.value = loadingOlder.value = sending.value = hasOlder.value = false
    errorMessage.value = sendError.value = readError.value = realtimeError.value = ''
    cursor = null
  }

  function startRoom() {
    resetRoom()
    if (!room()) return
    reconnect()
    void refresh()
    void markRead()
  }
  function onVisible() { if (visible()) void markRead() }
  function onOffline() { connection.value = 'offline'; realtimeError.value = '网络已断开，恢复后会重新同步消息。' }

  watch(identity, () => { if (mounted) startRoom() }, { flush: 'sync' })
  onMounted(() => {
    mounted = true
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    window.addEventListener('online', reconnect)
    window.addEventListener('offline', onOffline)
    startRoom()
  })
  onBeforeUnmount(() => {
    mounted = false
    resetRoom()
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('focus', onVisible)
    window.removeEventListener('online', reconnect)
    window.removeEventListener('offline', onOffline)
  })

  return { messages, loading, loadingOlder, hasOlder, sending, errorMessage, sendError, readError, realtimeError,
    connection, activity, maxLength, refresh, loadOlder, send, markRead, reconnect }
}
