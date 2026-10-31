import { computed, getCurrentScope, onScopeDispose, reactive, watch } from 'vue'
import type { AIFeature, AIResponse, DailyDiaryInput, DiaryMemory, LoveQuoteInput } from '#shared/types/ai'
import { localDiary, localLoveQuote } from '#shared/utils/aiFallback'
import { parseDailyDiaryInput, parseLoveQuoteInput } from '#shared/utils/aiInput'
import { beijingDate } from '../utils/anniversaryDates'

/** 只访问同源 Nuxt API；浏览器不读取、存储或发送 DeepSeek Key。 */
export function useAI() {
  const { $supabase } = useNuxtApp()
  const { user, profile } = useAuth()
  const seed = () => `${beijingDate()}:${profile.value?.coupleId || ''}`
  const state = {
    quote: reactive({ text: localLoveQuote(seed()), loading: false, isFallback: true, notice: '' }),
    diary: reactive({ text: '', loading: false, isFallback: false, notice: '' }),
  }
  const versions: Record<AIFeature, number> = { quote: 0, diary: 0 }
  const requests: Partial<Record<AIFeature, AbortController>> = {}
  let disposed = false

  function cancel() {
    for (const kind of ['quote', 'diary'] as const) {
      versions[kind]++; requests[kind]?.abort(); delete requests[kind]
      state[kind].loading = false
    }
  }

  async function accessToken(signal: AbortSignal, userId: string) {
    if (!$supabase) throw new Error('登录服务尚未配置。')
    const client = $supabase
    let timer: ReturnType<typeof setTimeout> | undefined
    let abort: () => void = () => {}
    try {
      const result = await Promise.race([
        client.auth.getSession(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('读取登录状态超时。')), 5000)
          abort = () => reject(new Error('请求已取消。'))
          if (signal.aborted) abort()
          else signal.addEventListener('abort', abort, { once: true })
        }),
      ])
      const session = result.data.session
      if (result.error || !session?.access_token || session.user.id !== userId) throw new Error('登录状态无效。')
      return session.access_token
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort) }
  }

  async function request(kind: AIFeature, prepare: () => LoveQuoteInput | DailyDiaryInput, fallback: () => string): Promise<string | null> {
    if (disposed) return null
    requests[kind]?.abort()
    const version = ++versions[kind]
    const controller = new AbortController()
    requests[kind] = controller
    const userId = user.value?.id, coupleId = profile.value?.coupleId
    const active = () => !disposed && version === versions[kind]
      && user.value?.id === userId && profile.value?.coupleId === coupleId
    state[kind].loading = true; state[kind].notice = ''
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, 45000)
    try {
      const payload = prepare()
      if (import.meta.server || !userId || !coupleId) throw new Error('请先登录并完成配对。')
      const token = await accessToken(controller.signal, userId)
      if (!active() || controller.signal.aborted) return null
      const response = await $fetch<AIResponse>(kind === 'quote' ? '/api/ai/love-quote' : '/api/ai/daily-diary', {
        method: 'POST', body: payload, retry: 0, timeout: 45000, signal: controller.signal,
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!active()) return null
      if (response?.source !== 'ai' || typeof response.text !== 'string' || !response.text.trim()
        || [...response.text].length > (kind === 'quote' ? 20 : 1000)) throw new Error('AI 返回内容无效。')
      state[kind].text = response.text.trim()
      state[kind].isFallback = false
      return state[kind].text
    } catch (error) {
      if (!active() || (controller.signal.aborted && !timedOut)) return null
      state[kind].text = fallback()
      state[kind].isFallback = true
      const data = error && typeof error === 'object' && 'data' in error ? error.data : undefined
      const detail = data && typeof data === 'object' && 'data' in data ? data.data : undefined
      const code = detail && typeof detail === 'object' && 'code' in detail ? detail.code : undefined
      const reason = code === 'AI_BALANCE_INSUFFICIENT' ? 'AI 服务额度暂时不足' : 'AI 暂时未连接'
      state[kind].notice = kind === 'quote'
        ? `${reason}，先送你一句本地情话。`
        : `${reason}，以下是根据所选记录做的本地整理。`
      return state[kind].text
    } finally {
      clearTimeout(timer)
      if (active()) { state[kind].loading = false; delete requests[kind] }
    }
  }

  function fetchLoveQuote(input: LoveQuoteInput) {
    return request('quote', () => parseLoveQuoteInput(input), () => localLoveQuote(seed()))
  }
  function generateDiary(memories: DiaryMemory[]) {
    let selected: DiaryMemory[] = []
    return request('diary', () => {
      const input = parseDailyDiaryInput({ memories })
      selected = input.memories
      return input
    }, () => localDiary(selected))
  }

  watch([() => user.value?.id, () => profile.value?.coupleId], () => {
    cancel()
    Object.assign(state.quote, { text: localLoveQuote(seed()), isFallback: true, notice: '' })
    Object.assign(state.diary, { text: '', isFallback: false, notice: '' })
  }, { flush: 'sync' })
  if (getCurrentScope()) onScopeDispose(() => { disposed = true; cancel(); state.diary.text = '' })

  return {
    loveQuote: computed(() => state.quote.text), quoteLoading: computed(() => state.quote.loading),
    quoteIsFallback: computed(() => state.quote.isFallback), quoteNotice: computed(() => state.quote.notice),
    diary: computed(() => state.diary.text), diaryLoading: computed(() => state.diary.loading),
    diaryIsFallback: computed(() => state.diary.isFallback), diaryNotice: computed(() => state.diary.notice),
    fetchLoveQuote, generateDiary, cancel,
  }
}
