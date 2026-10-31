<script setup lang="ts">
import { Heart, LoaderCircle, MessageCircleHeart, Send, Sparkles, Square, Trash2, X } from '@lucide/vue'
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAIChat } from '../composables/useAIChat'
import { CHAT_USER_LIMIT } from '#shared/utils/aiChat'
import '../styles/ai-chat.css'

const { allMessages, summary, loading, notice, sendMessage, stop, clear } = useAIChat()
const dialog = ref<HTMLDialogElement | null>(null)
const launcher = ref<HTMLButtonElement | null>(null)
const input = ref<HTMLTextAreaElement | null>(null)
const scroller = ref<HTMLElement | null>(null)
const isOpen = ref(false)
const draft = ref('')
let scrollFrame = 0
let previousOverflow = ''
let sizeObserver: ResizeObserver | undefined

function resizeInput() {
  if (!input.value) return
  input.value.style.height = 'auto'
  input.value.style.height = `${Math.min(input.value.scrollHeight, 128)}px`
}
async function scrollBottom() {
  await nextTick()
  if (!isOpen.value || !scroller.value || scrollFrame) return
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    scroller.value?.scrollTo({ top: scroller.value.scrollHeight, behavior: reduced ? 'auto' : 'smooth' })
  })
}
async function openChat() {
  if (!dialog.value || isOpen.value) return
  dialog.value.showModal(); isOpen.value = true
  previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'
  await nextTick(); input.value?.focus(); resizeInput(); void scrollBottom()
}
function closeChat() {
  if (isOpen.value) document.body.style.overflow = previousOverflow
  stop(); dialog.value?.close(); isOpen.value = false
  launcher.value?.focus()
}
function closeOnBackdrop(event: MouseEvent) {
  if (event.target !== dialog.value) return
  const bounds = dialog.value.getBoundingClientRect()
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeChat()
}
function submit() {
  if (loading.value || !draft.value.trim()) return
  const text = draft.value
  draft.value = ''
  void sendMessage(text)
  void nextTick(() => { resizeInput(); input.value?.focus() })
}
function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return
  event.preventDefault(); submit()
}
function clearChat() { clear(); input.value?.focus() }
watch([() => allMessages.value.length, () => allMessages.value.at(-1)?.content, loading], () => { void scrollBottom() }, { flush: 'post' })
onMounted(() => {
  sizeObserver = new ResizeObserver(() => { void scrollBottom() })
  if (scroller.value) sizeObserver.observe(scroller.value)
})
onBeforeUnmount(() => {
  sizeObserver?.disconnect()
  if (scrollFrame) cancelAnimationFrame(scrollFrame)
  if (isOpen.value) document.body.style.overflow = previousOverflow
  dialog.value?.close()
})
</script>

<template>
  <button ref="launcher" class="ai-chat-launcher" type="button" aria-label="与大毛聊聊" title="与大毛聊聊" aria-haspopup="dialog" aria-controls="ai-companion-dialog" :aria-expanded="isOpen" @click="openChat">
    <MessageCircleHeart :size="26" aria-hidden="true" /><span>与大毛聊聊</span>
  </button>

  <Teleport to="body">
    <dialog id="ai-companion-dialog" ref="dialog" class="ai-chat love-glass" aria-labelledby="ai-chat-title" aria-describedby="ai-chat-description" @cancel.prevent="closeChat" @click="closeOnBackdrop">
      <header class="ai-chat__header">
        <span class="ai-chat__avatar"><Sparkles :size="23" aria-hidden="true" /></span>
        <div class="ai-chat__heading"><h2 id="ai-chat-title">与大毛聊聊</h2><p id="ai-chat-description">大毛在这里，听你慢慢说</p></div>
        <button class="ai-chat__icon" type="button" :disabled="!allMessages.length" aria-label="清空与大毛的对话" title="清空与大毛的对话" @click="clearChat"><Trash2 :size="18" aria-hidden="true" /></button>
        <button class="ai-chat__icon" type="button" aria-label="关闭与大毛的对话" @click="closeChat"><X :size="21" aria-hidden="true" /></button>
      </header>
      <details v-if="summary" class="ai-chat__memory">
        <summary>大毛记下的小事</summary>
        <p>{{ summary }}</p>
      </details>

      <div ref="scroller" class="ai-chat__messages" role="log" aria-label="与大毛的聊天记录" aria-live="polite" aria-relevant="additions" :aria-busy="loading">
        <div v-if="!allMessages.length" class="ai-chat__welcome">
          <span><Heart :size="30" aria-hidden="true" /></span><h3>今天，想和大毛聊些什么？</h3>
          <p>一件开心的小事，或是还没说出口的心情，<br>都可以慢慢说给我听。</p>
          <button type="button" @click="draft = '帮我们想一个简单又浪漫的约会吧'; input?.focus(); resizeInput()">让大毛帮我们想个约会 <Sparkles :size="14" aria-hidden="true" /></button>
        </div>
        <article v-for="message in allMessages" :key="message.id" class="ai-chat__row" :class="{ 'is-mine': message.role === 'user' }" :data-source="message.source">
          <span class="ai-chat__sender">{{ message.role === 'user' ? '我' : '大毛' }}</span>
          <p class="ai-chat__bubble">
            <span v-if="message.content">{{ message.content }}</span>
            <span v-else-if="message.status === 'streaming'" class="ai-chat__thinking"><LoaderCircle :size="15" aria-hidden="true" />大毛正在想怎么回答你…</span>
            <span v-else>这次回复已暂停。</span>
            <span v-if="message.content && message.status === 'streaming'" class="ai-chat__cursor" aria-hidden="true" />
          </p>
          <span v-if="message.source === 'local'" class="ai-chat__label">本地暖心回复</span>
          <span v-else-if="message.status === 'stopped' || message.status === 'partial'" class="ai-chat__label">{{ message.status === 'stopped' ? '已暂停' : '回复未完成' }}</span>
        </article>
      </div>

      <p v-if="notice" class="ai-chat__notice" role="status">{{ notice }}</p>
      <form class="ai-chat__composer" @submit.prevent="submit">
        <label class="sr-only" for="ai-chat-input">想对大毛说的话</label>
        <textarea id="ai-chat-input" ref="input" v-model="draft" rows="1" :maxlength="CHAT_USER_LIMIT" placeholder="想和大毛说些什么？" @input="resizeInput" @keydown="onKeydown" />
        <button v-if="loading" class="ai-chat__send" type="button" aria-label="停止大毛的回复" @click="stop"><Square :size="15" aria-hidden="true" /><span>停止</span></button>
        <button v-else class="ai-chat__send" type="submit" :disabled="!draft.trim()" aria-label="发送给大毛"><Send :size="18" aria-hidden="true" /><span>发送</span></button>
        <p>AI 生成 · 对话与回忆刷新后清空 <span>Enter 发送 / Shift + Enter 换行</span></p>
      </form>
    </dialog>
  </Teleport>
</template>
