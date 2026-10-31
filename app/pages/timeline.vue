<script setup lang="ts">
import { ArrowLeft, CalendarDays, Heart, LoaderCircle, MapPin, Plus, WandSparkles, X } from '@lucide/vue'
import { useAI } from '../composables/useAI'
import { useTypewriter } from '../composables/useTypewriter'
import { diarySelection } from '../utils/aiPresentation'
import { beijingDate } from '../utils/anniversaryDates'
import '../styles/timeline.css'
import '../styles/ai-features.css'

useHead({ title: '我们的时光 · Love小家' })

const { user, profile } = useAuth()
const { rows, loading, errorMessage, hasMore, loadMore, refresh, createMemory } = useMemoryTimeline()
const { diaryLoading, diaryIsFallback, diaryNotice, generateDiary, cancel: cancelAi } = useAI()
const { displayedText, fullText, typing, start: typeDiary, clear: clearDiary, finish: finishDiary } = useTypewriter()
const diaryDialog = ref<HTMLDialogElement | null>(null)
const diaryDay = ref(beijingDate())
const todaySelection = computed(() => diarySelection(rows.value, diaryDay.value))
const diaryBusy = computed(() => diaryLoading.value || typing.value)
const diaryMeta = ref({ date: '', count: 0, total: 0, excerpted: false })
let diaryGeneration = 0
let dayTimer: ReturnType<typeof setInterval> | undefined

async function openDiary() {
  if (diaryBusy.value || loading.value) return
  diaryDay.value = beijingDate()
  const selection = diarySelection(rows.value, diaryDay.value)
  if (!selection.memories.length) return
  const version = ++diaryGeneration
  clearDiary()
  diaryMeta.value = { date: diaryDay.value, count: selection.memories.length, total: selection.totalCount, excerpted: selection.excerpted }
  diaryDialog.value?.showModal()
  const result = await generateDiary(selection.memories)
  if (version === diaryGeneration && diaryDialog.value?.open && result !== null) typeDiary(result)
}
function closeDiary() {
  diaryGeneration++
  cancelAi()
  clearDiary()
  diaryDialog.value?.close()
}
onMounted(() => { dayTimer = setInterval(() => { diaryDay.value = beijingDate() }, 60000) })
const editor = ref<HTMLDialogElement | null>(null)
const titleInput = ref<HTMLInputElement | null>(null)
const saving = ref(false)
const formError = ref('')
const savedNotice = ref('')
let saveGeneration = 0

function today() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

const form = reactive({ date: today(), title: '', body: '', location: '' })

function openEditor() {
  Object.assign(form, { date: today(), title: '', body: '', location: '' })
  formError.value = ''
  savedNotice.value = ''
  editor.value?.showModal()
  titleInput.value?.focus()
}

function closeEditor() {
  if (!saving.value) editor.value?.close()
}

async function saveMemory() {
  if (saving.value) return
  const version = ++saveGeneration
  saving.value = true
  formError.value = ''
  try {
    await createMemory({ ...form })
    if (version !== saveGeneration) return
    editor.value?.close()
    savedNotice.value = '这段回忆已保存。'
    // 保存已成功；列表刷新失败由列表自身提示，避免重复提交同一条回忆。
    await refresh()
  } catch (error) {
    if (version === saveGeneration) {
      formError.value = error instanceof Error ? error.message : '保存失败，请稍后重试。'
    }
  } finally {
    if (version === saveGeneration) saving.value = false
  }
}

watch([() => user.value?.id, () => profile.value?.coupleId], () => {
  saveGeneration++
  saving.value = false
  formError.value = ''
  savedNotice.value = ''
  editor.value?.close()
  closeDiary()
}, { flush: 'sync' })

onBeforeUnmount(() => { saveGeneration++; editor.value?.close(); closeDiary(); clearInterval(dayTimer) })
</script>

<template>
  <main class="memory-timeline bg-love-bg text-love-ink">
    <div class="memory-timeline__layout">
      <nav class="flex items-center justify-between gap-3" aria-label="小家导航">
        <NuxtLink to="/" class="memory-timeline__back"><ArrowLeft :size="18" aria-hidden="true" />回到小家</NuxtLink>
        <div class="flex items-center gap-4"><NuxtLink to="/whispers" class="memory-timeline__back">悄悄话</NuxtLink><NuxtLink to="/albums" class="memory-timeline__back">相册</NuxtLink></div>
      </nav>
      <header class="memory-timeline__header">
        <div>
          <p class="memory-timeline__eyebrow">OUR MEMORIES</p>
          <h1>我们的时光</h1>
          <p class="memory-timeline__intro">把普通日子里，想记住的瞬间留下来。</p>
        </div>
        <div class="memory-timeline__header-actions">
        <button id="new-memory-button" class="memory-timeline__primary" type="button" :disabled="saving" @click="openEditor">
          <Plus :size="19" aria-hidden="true" />记录新回忆
        </button>
        <button id="generate-ai-diary" class="memory-timeline__secondary" type="button"
          :disabled="saving || loading || diaryBusy || !todaySelection.memories.length" @click="openDiary">
          <LoaderCircle v-if="diaryBusy" :size="18" class="memory-timeline__spinner" aria-hidden="true" />
          <WandSparkles v-else :size="18" aria-hidden="true" />让 AI 写一篇今日日记
        </button>
        </div>
      </header>

      <p class="ai-diary__help">{{ loading ? '正在整理可以写进日记的回忆…' : todaySelection.memories.length
        ? `依据当前列表中 ${diaryDay} 的 ${todaySelection.totalCount} 条回忆，写下今天的我们。${todaySelection.excerpted ? '回忆较多或较长，本次将使用节选。' : ''}`
        : '今天还没有显示在列表中的回忆，先记录一段今天的故事吧。' }}</p>

      <p v-if="savedNotice" class="memory-timeline__success" role="status">{{ savedNotice }}</p>
      <div v-if="errorMessage" class="memory-timeline__error" role="alert">
        <p>{{ errorMessage }}</p>
        <button type="button" :disabled="loading" @click="rows.length ? loadMore() : refresh()">重新加载</button>
      </div>

      <div v-if="!rows.length && !loading && !errorMessage" class="love-glass memory-timeline__empty">
        <Heart :size="32" aria-hidden="true" />
        <h2>第一条回忆，从今天开始</h2>
        <p>一句话，一个地点，都是我们故事的一部分。</p>
        <button class="memory-timeline__secondary" type="button" @click="openEditor">记录第一段回忆</button>
      </div>

      <ol v-if="rows.length" class="memory-timeline__list">
        <li v-for="memory in rows" :key="memory.id" class="memory-timeline__entry" :data-memory-id="memory.id">
          <span class="memory-timeline__dot" aria-hidden="true" />
          <article class="love-glass memory-timeline__card">
            <time :datetime="memory.date"><CalendarDays :size="15" aria-hidden="true" />{{ memory.date }}</time>
            <h2>{{ memory.title }}</h2>
            <p v-if="memory.body" class="memory-timeline__body">{{ memory.body }}</p>
            <p v-if="memory.location" class="memory-timeline__location"><MapPin :size="15" aria-hidden="true" />{{ memory.location }}</p>
          </article>
        </li>
      </ol>

      <footer class="memory-timeline__footer">
        <p v-if="loading" role="status"><LoaderCircle :size="18" class="memory-timeline__spinner" aria-hidden="true" />正在打开时光册…</p>
        <button v-else-if="hasMore && rows.length && !errorMessage" class="memory-timeline__secondary" type="button" @click="loadMore">加载更多</button>
        <p v-else-if="!hasMore && rows.length">已经看到最早的回忆</p>
      </footer>
    </div>

    <dialog id="memory-editor" ref="editor" class="love-glass memory-timeline__dialog" aria-labelledby="memory-editor-title" @cancel.prevent="closeEditor">
      <header class="memory-timeline__dialog-header">
        <div><p class="memory-timeline__eyebrow">A MOMENT TO KEEP</p><h2 id="memory-editor-title">记录新回忆</h2></div>
        <button class="memory-timeline__close" type="button" aria-label="关闭新回忆表单" :disabled="saving" @click="closeEditor"><X :size="21" aria-hidden="true" /></button>
      </header>
      <form :aria-busy="saving" @submit.prevent="saveMemory">
        <fieldset :disabled="saving">
          <label class="memory-timeline__field" for="memory-date"><span>日期</span><input id="memory-date" v-model="form.date" type="date" required></label>
          <label class="memory-timeline__field" for="memory-title"><span>标题 <small>必填</small></span><input id="memory-title" ref="titleInput" v-model="form.title" type="text" maxlength="120" required placeholder="给这一天起个名字" :aria-invalid="formError ? true : undefined" :aria-describedby="formError ? 'memory-form-error' : undefined"></label>
          <label class="memory-timeline__field" for="memory-body"><span>正文 <small>选填</small></span><textarea id="memory-body" v-model="form.body" rows="5" maxlength="1000" placeholder="慢慢写下那些想记住的细节…" /><small class="memory-timeline__counter">{{ form.body.length }} / 1000</small></label>
          <label class="memory-timeline__field" for="memory-location"><span>地点 <small>选填</small></span><input id="memory-location" v-model="form.location" type="text" maxlength="80" placeholder="在哪里留下的回忆"></label>
        </fieldset>
        <p v-if="formError" id="memory-form-error" class="memory-timeline__error" role="alert">{{ formError }}</p>
        <footer class="memory-timeline__dialog-actions">
          <button class="memory-timeline__secondary" type="button" :disabled="saving" @click="closeEditor">取消</button>
          <button class="memory-timeline__primary" type="submit" :disabled="saving"><LoaderCircle v-if="saving" :size="18" class="memory-timeline__spinner" aria-hidden="true" />{{ saving ? '正在保存…' : '保存回忆' }}</button>
        </footer>
      </form>
    </dialog>

    <dialog id="ai-diary-dialog" ref="diaryDialog" class="love-glass memory-timeline__dialog ai-diary__dialog"
      aria-labelledby="ai-diary-heading" @cancel.prevent="closeDiary" @click.self="closeDiary">
      <header class="memory-timeline__dialog-header">
        <div><p class="memory-timeline__eyebrow">A LETTER FROM OUR DAY</p><h2 id="ai-diary-heading">今天的我们</h2></div>
        <button class="memory-timeline__close" type="button" aria-label="关闭日记预览" @click="closeDiary"><X :size="21" aria-hidden="true" /></button>
      </header>
      <p class="ai-diary__description">{{ diaryMeta.date }} · 依据 {{ diaryMeta.count }} 条今日回忆{{ diaryMeta.excerpted ? '的节选' : '' }}生成</p>
      <div v-if="diaryLoading" class="ai-diary__loading" role="status">
        <LoaderCircle :size="28" class="memory-timeline__spinner" aria-hidden="true" />
        <p>正在把今天的小事，写成我们的故事…</p><small>请稍候，你可以随时关闭。</small>
      </div>
      <template v-else-if="fullText">
        <p v-if="diaryIsFallback" class="ai-diary__notice" role="status">{{ diaryNotice }}</p>
        <p class="ai-diary__body" :data-source="diaryIsFallback ? 'local' : 'ai'" :data-typing="typing" aria-hidden="true">{{ displayedText }}<span v-if="typing" class="ai-diary__cursor" aria-hidden="true" /></p>
        <p class="sr-only" role="status">{{ typing ? '日记正在逐字显示，可以选择显示全文。' : fullText }}</p>
        <p class="ai-diary__copy-hint">日记预览 · 可以选中文字复制留存。</p>
      </template>
      <footer>
        <button v-if="typing" class="memory-timeline__secondary" type="button" @click="finishDiary">显示全文</button>
        <button class="memory-timeline__primary" type="button" @click="closeDiary">{{ diaryLoading ? '取消生成' : '关闭日记' }}</button>
      </footer>
    </dialog>
  </main>
</template>
