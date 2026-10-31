import { computed, getCurrentScope, onScopeDispose, reactive, readonly, ref, watch } from 'vue'
import { CHAT_REPLY_LIMIT, CHAT_USER_LIMIT, LOCAL_CHAT_REPLIES, chatNotice, parseChatInput, recentChatTurns } from '#shared/utils/aiChat'
import { readSseData } from '#shared/utils/aiSse'

export type CompanionMessage = {
  id: number
  role: 'user' | 'assistant'
  content: string
  status: 'complete' | 'streaming' | 'stopped' | 'partial'
  source: 'user' | 'ai' | 'local'
}

/** 对话只保存在组件内存；退出账号、切换空间或离开首页时清空。 */
export function useAIChat() {
  const { $supabase } = useNuxtApp()
  const { user, profile } = useAuth()
  const messages = ref<CompanionMessage[]>([])
  const loading = ref(false)
  const notice = ref('')
  let request: AbortController | undefined
  let generation = 0, sequence = 0, disposed = false

  function stop() {
    generation++
    request?.abort(); request = undefined
    for (const message of messages.value) {
      if (message.status === 'streaming') message.status = 'stopped'
    }
    loading.value = false
  }
  function clear() { stop(); messages.value = []; notice.value = '' }

  async function token(signal: AbortSignal, userId: string) {
    if (!$supabase) throw new Error('AUTH_UNAVAILABLE')
    let timer: ReturnType<typeof setTimeout> | undefined
    let abort = () => {}
    try {
      const response = await Promise.race([
        $supabase.auth.getSession(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('AUTH_UNAVAILABLE')), 5000)
          abort = () => reject(new Error('Request cancelled'))
          if (signal.aborted) abort()
          else signal.addEventListener('abort', abort, { once: true })
        }),
      ])
      if (response.error || response.data.session?.user.id !== userId || !response.data.session.access_token) {
        throw new Error('AUTH_REQUIRED')
      }
      return response.data.session.access_token
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort) }
  }

  async function sendMessage(value: string) {
    const content = value.trim()
    if (disposed || loading.value || !content) return
    if ([...content].length > CHAT_USER_LIMIT) { notice.value = `每条消息最多 ${CHAT_USER_LIMIT} 个字。`; return }
    const userId = user.value?.id, coupleId = profile.value?.coupleId
    const current = ++generation
    const controller = new AbortController()
    const active = () => !disposed && current === generation && user.value?.id === userId && profile.value?.coupleId === coupleId
    request = controller; notice.value = ''; loading.value = true
    messages.value.push({ id: ++sequence, role: 'user', content, status: 'complete', source: 'user' })
    const context = recentChatTurns(messages.value.filter(message => message.status === 'complete')
      .map(({ role, content }) => ({ role, content })))
    const reply = reactive<CompanionMessage>({ id: ++sequence, role: 'assistant', content: '', status: 'streaming', source: 'ai' })
    messages.value.push(reply)
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, 60000)
    try {
      if (!userId) throw new Error('AUTH_REQUIRED')
      if (!coupleId) throw new Error('PAIRING_REQUIRED')
      const input = parseChatInput({ messages: context })
      const accessToken = await token(controller.signal, userId)
      if (!active() || controller.signal.aborted) return
      const response = await fetch('/api/ai/chat', {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(input),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(typeof data?.data?.code === 'string' ? data.data.code : 'AI_UNAVAILABLE')
      }
      if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('AI_UNAVAILABLE')
      let complete = false
      for await (const frame of readSseData(response.body, controller.signal)) {
        if (!active()) return
        const event = JSON.parse(frame)
        if (event?.type === 'delta' && typeof event.text === 'string') {
          if ([...reply.content, ...event.text].length > CHAT_REPLY_LIMIT) throw new Error('AI_UNAVAILABLE')
          reply.content += event.text
        } else if (event?.type === 'done') { complete = true; break }
        else if (event?.type === 'error') throw new Error(typeof event.code === 'string' ? event.code : 'AI_UNAVAILABLE')
        else throw new Error('AI_UNAVAILABLE')
      }
      if (!complete || !reply.content.trim()) throw new Error('AI_UNAVAILABLE')
      reply.status = 'complete'
    } catch (error) {
      if (!active() || (controller.signal.aborted && !timedOut)) return
      notice.value = chatNotice(timedOut ? 'AI_TIMEOUT' : error instanceof Error ? error.message : 'AI_UNAVAILABLE')
      if (reply.content.trim()) {
        // 保留已收到的真实文字，不把中断伪装成完整回答。
        reply.status = 'partial'
        notice.value += ' 已收到的内容为未完成回复。'
      } else {
        reply.content = LOCAL_CHAT_REPLIES[Math.floor(sequence / 2 - 1) % LOCAL_CHAT_REPLIES.length]!
        reply.source = 'local'; reply.status = 'complete'
      }
    } finally {
      clearTimeout(timer)
      controller.abort()
      if (active()) { loading.value = false; request = undefined }
    }
  }

  watch([() => user.value?.id, () => profile.value?.coupleId], clear, { flush: 'sync' })
  if (getCurrentScope()) onScopeDispose(() => { disposed = true; clear() })
  return { messages: readonly(messages), loading: computed(() => loading.value), notice: computed(() => notice.value), sendMessage, stop, clear }
}
