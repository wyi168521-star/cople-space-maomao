<script setup lang="ts">
import { ArrowLeft, ChevronUp, Heart, LoaderCircle, MessageCircleHeart, RefreshCw, Send } from '@lucide/vue'
import type { Whisper } from '../composables/useWhispers'
import '../styles/whispers.css'

useHead({ title: '悄悄话 · Love小家' })

const { user, profile } = useAuth()
const { messages, loading, loadingOlder, hasOlder, sending, errorMessage, sendError, readError, realtimeError,
  connection, activity, maxLength, refresh, loadOlder, send, markRead, reconnect } = useWhispers()
const messageArea = ref<HTMLDivElement | null>(null)
const editor = ref<HTMLTextAreaElement | null>(null)
const draft = ref('')
let composing = false
const partnerName = computed(() => profile.value?.partnerName || '我们的悄悄话')
const partnerInitial = computed(() => [...partnerName.value][0] || '♡')
const myInitial = computed(() => [...(profile.value?.displayName || '我')][0] || '我')
const dayFormatter = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric' })
const clockFormatter = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const dayLabel = (timestamp: string) => dayFormatter.format(new Date(timestamp))
const timeLabel = (timestamp: string) => clockFormatter.format(new Date(timestamp))
const isMine = (message: Whisper) => message.sender_id === user.value?.id
const canSend = computed(() => Boolean(draft.value.trim() && user.value?.id && profile.value?.coupleId) && !sending.value)
const connectionLabel = computed(() => connection.value === 'connected' ? '已连接' : connection.value === 'connecting' ? '正在连接…' : '连接中断')

async function scrollToBottom(behavior: ScrollBehavior = 'smooth') {
  await nextTick()
  const area = messageArea.value
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : behavior
  area?.scrollTo({ top: area.scrollHeight, behavior: motion })
}

function resizeEditor() {
  const element = editor.value
  if (!element) return
  element.style.height = 'auto'
  element.style.height = draft.value ? `${Math.min(element.scrollHeight + 2, 160)}px` : ''
  element.style.overflowY = element.scrollHeight > 160 ? 'auto' : 'hidden'
}

async function submitMessage() {
  if (!canSend.value || composing) return
  const text = draft.value
  const identity = `${user.value?.id}:${profile.value?.coupleId}`
  if (await send(text)) {
    if (identity !== `${user.value?.id}:${profile.value?.coupleId}`) return
    if (draft.value === text) draft.value = ''
    await nextTick()
    resizeEditor()
    await scrollToBottom()
    editor.value?.focus({ preventScroll: true })
  }
}

function onEditorKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing || composing || event.keyCode === 229) return
  event.preventDefault()
  void submitMessage()
}

function messageText(message: Whisper) {
  if (message.body?.trim()) return message.body
  if (message.media_type === 'photo') return '发送了一张照片'
  if (message.media_type === 'video') return '发送了一段视频'
  if (message.media_type === 'voice') return '发送了一段语音'
  return '（空消息）'
}

watch(loading, async (pending, previous) => {
  if (pending || !previous || errorMessage.value) return
  await scrollToBottom('instant')
}, { flush: 'post' })

watch(activity, () => { void scrollToBottom() }, { flush: 'post' })
watch([() => user.value?.id, () => profile.value?.coupleId], async () => {
  draft.value = ''
  composing = false
  await nextTick()
  resizeEditor()
}, { flush: 'sync' })

async function showOlder() {
  const area = messageArea.value
  if (!area) return
  const height = area.scrollHeight
  const position = area.scrollTop
  const spaceId = profile.value?.coupleId
  const previousActivity = activity.value
  const loaded = await loadOlder()
  await nextTick()
  if (loaded && area === messageArea.value && spaceId === profile.value?.coupleId) {
    if (activity.value === previousActivity) area.scrollTop = position + area.scrollHeight - height
    else await scrollToBottom()
  }
}
</script>

<template>
  <main class="whispers-page">
    <div class="whispers-page__layout">
      <nav class="whispers-page__nav" aria-label="小家导航">
        <NuxtLink to="/"><ArrowLeft :size="17" aria-hidden="true" />回到小家</NuxtLink>
        <div><NuxtLink to="/timeline">时光轴</NuxtLink><NuxtLink to="/whispers" aria-current="page">悄悄话</NuxtLink><NuxtLink to="/albums">相册</NuxtLink></div>
      </nav>

      <section class="love-glass whispers-chat" aria-labelledby="whispers-title">
        <header class="whispers-chat__header">
          <span class="whispers-chat__portrait" aria-hidden="true">{{ partnerInitial }}</span>
          <div class="whispers-chat__heading"><p>WHISPERS BETWEEN US</p><h1 id="whispers-title">{{ partnerName }}</h1><span id="whispers-connection" :data-state="connection" role="status">{{ connectionLabel }}</span></div>
          <button id="whispers-refresh" class="whispers-chat__refresh" type="button" aria-label="刷新历史消息" title="刷新历史消息" :disabled="loading || loadingOlder" @click="refresh"><RefreshCw :size="18" :class="{ 'whispers-chat__spinner': loading }" aria-hidden="true" /></button>
        </header>

        <aside v-if="realtimeError" class="whispers-chat__notice" role="status"><p>{{ realtimeError }}</p><button type="button" @click="reconnect">重新连接</button></aside>
        <aside v-if="readError" class="whispers-chat__notice" role="alert"><p>{{ readError }}</p><button type="button" @click="markRead">重试已读同步</button></aside>

        <div id="whispers-message-area" ref="messageArea" class="whispers-chat__messages" role="region" aria-label="聊天历史" tabindex="0" :aria-busy="loading">
          <div v-if="loading" class="whispers-chat__state" role="status"><LoaderCircle :size="23" class="whispers-chat__spinner" aria-hidden="true" /><p>正在翻开我们的悄悄话…</p></div>
          <template v-else>
            <div v-if="errorMessage" class="whispers-chat__error" role="alert"><p>{{ errorMessage }}</p><button type="button" :disabled="loadingOlder" @click="messages.length ? showOlder() : refresh()">重新加载</button></div>
            <div v-if="!messages.length && !errorMessage" class="whispers-chat__state whispers-chat__empty"><MessageCircleHeart :size="38" aria-hidden="true" /><h2>还没有悄悄话</h2><p>想念、日常和小秘密，都可以留在这里。</p></div>
            <div v-if="hasOlder" class="whispers-chat__history"><button id="whispers-load-older" type="button" :disabled="loadingOlder" @click="showOlder"><LoaderCircle v-if="loadingOlder" :size="16" class="whispers-chat__spinner" aria-hidden="true" /><ChevronUp v-else :size="16" aria-hidden="true" />{{ loadingOlder ? '正在读取…' : '加载更早的消息' }}</button></div>
            <p v-else-if="messages.length" class="whispers-chat__beginning">故事从这里开始</p>

            <ol class="whispers-chat__list">
              <template v-for="(message, index) in messages" :key="message.id">
                <li v-if="index === 0 || dayLabel(message.created_at) !== dayLabel(messages[index - 1]!.created_at)" class="whispers-chat__day">{{ dayLabel(message.created_at) }}</li>
                <li class="whispers-chat__row" :class="{ 'is-mine': isMine(message) }" :data-message-id="message.id" :data-mine="isMine(message)">
                  <span class="whispers-chat__avatar" aria-hidden="true">{{ isMine(message) ? myInitial : partnerInitial }}</span>
                  <div class="whispers-chat__content">
                    <span class="whispers-chat__sender">{{ isMine(message) ? '我' : partnerName }}</span>
                    <p class="whispers-chat__bubble rounded-2xl px-3 py-2.5 shadow-[0_3px_10px_rgba(111,63,136,0.04)] sm:px-4 sm:py-3" :class="isMine(message) ? 'rounded-tr-md' : 'rounded-tl-md'">{{ messageText(message) }}</p>
                    <div class="whispers-chat__meta"><time :datetime="message.created_at" :title="`${dayLabel(message.created_at)} ${timeLabel(message.created_at)}`">{{ timeLabel(message.created_at) }}</time><span v-if="isMine(message)" :data-read="Boolean(message.read_at)" :class="{ 'is-read': message.read_at }">{{ message.read_at ? '已读' : '未读' }}</span></div>
                  </div>
                </li>
              </template>
            </ol>
          </template>
        </div>

        <form class="whispers-chat__composer" :aria-busy="sending" @submit.prevent="submitMessage">
          <label class="sr-only" for="whispers-draft">消息内容</label>
          <textarea id="whispers-draft" ref="editor" v-model="draft" rows="1" :maxlength="maxLength" :readonly="sending" placeholder="想说的话，慢慢告诉 TA…" aria-describedby="whispers-input-help" @input="resizeEditor" @keydown="onEditorKeydown" @compositionstart="composing = true" @compositionend="composing = false" />
          <button id="whispers-send" type="submit" :disabled="!canSend"><LoaderCircle v-if="sending" :size="18" class="whispers-chat__spinner" aria-hidden="true" /><Send v-else :size="18" aria-hidden="true" /><span>{{ sending ? '发送中' : '发送' }}</span></button>
          <p v-if="sendError" class="whispers-chat__send-error" role="alert">{{ sendError }}</p>
          <p id="whispers-input-help"><Heart :size="12" aria-hidden="true" />Enter 发送 · Shift + Enter 换行</p>
        </form>
      </section>
    </div>
  </main>
</template>
