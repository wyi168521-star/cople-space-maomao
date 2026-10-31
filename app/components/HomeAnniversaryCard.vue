<script setup lang="ts">
import { CalendarHeart, LoaderCircle, Plus, Sparkles, X } from '@lucide/vue'
import '../styles/home-anniversary.css'

const { user, profile } = useAuth()
const { nextAnniversary, todayAnniversaries, today, anniversariesLoading, errorMessage,
  loadAnniversaries, createAnniversary } = useAnniversaries()
const identity = computed(() => `${user.value?.id || ''}:${profile.value?.coupleId || ''}`)
const todayTitles = computed(() => todayAnniversaries.value.map(event => event.title).join('、'))
const editor = ref<HTMLDialogElement | null>(null)
const titleInput = ref<HTMLInputElement | null>(null)
const saving = ref(false)
const formError = ref('')
const notice = ref('')
const form = reactive({ title: '', date: today.value, repeat: true })
let saveGeneration = 0
let effectGeneration = 0
let mounted = false
let canvas: HTMLCanvasElement | undefined
let celebration: { reset: () => void } | undefined
const celebrated = new Set<string>()

function stopCelebration() {
  effectGeneration++
  celebration?.reset()
  canvas?.remove()
  celebration = undefined
  canvas = undefined
}

async function celebrateToday() {
  if (!mounted || anniversariesLoading.value || errorMessage.value || !todayTitles.value) return
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const key = `${identity.value}:${today.value}`
  if (celebrated.has(key)) return
  celebrated.add(key)
  stopCelebration()
  const version = effectGeneration
  try {
    const { default: confetti } = await import('canvas-confetti')
    if (!mounted || version !== effectGeneration || key !== `${identity.value}:${today.value}`) return
    const element = document.createElement('canvas')
    element.dataset.anniversaryConfetti = 'true'
    element.setAttribute('aria-hidden', 'true')
    element.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:1000;'
    document.body.append(element)
    canvas = element
    const fire = confetti.create(element, { resize: true, useWorker: false, disableForReducedMotion: true })
    celebration = fire
    const options = { colors: ['#c9a0dc', '#e8b4b8', '#ee78a7', '#b46ee3', '#f5e6f0'], ticks: 220, spread: 90, disableForReducedMotion: true }
    await Promise.all([
      fire({ ...options, particleCount: 90, angle: 60, startVelocity: 48, origin: { x: 0, y: .65 } }),
      fire({ ...options, particleCount: 90, angle: 120, startVelocity: 48, origin: { x: 1, y: .65 } }),
      fire({ ...options, particleCount: 65, spread: 130, startVelocity: 30, origin: { x: .5, y: .3 } }),
    ])
    if (version === effectGeneration) stopCelebration()
  } catch {
    if (version === effectGeneration) stopCelebration()
    if (import.meta.dev) console.warn('[LoveAnniversary] Celebration unavailable; anniversary content remains visible.')
  }
}

function openEditor() {
  Object.assign(form, { title: '', date: today.value, repeat: true })
  formError.value = ''
  notice.value = ''
  editor.value?.showModal()
  titleInput.value?.focus()
}
function closeEditor() { if (!saving.value) editor.value?.close() }
async function save() {
  if (saving.value) return
  const version = ++saveGeneration
  saving.value = true
  formError.value = ''
  try {
    await createAnniversary({ title: form.title, targetDate: form.date, repeatYearly: form.repeat, kind: 'anniversary' })
    if (version !== saveGeneration) return
    editor.value?.close()
    notice.value = '纪念日已保存，多了一份一起期待的日子。'
  } catch (error) {
    if (version === saveGeneration) formError.value = error instanceof Error ? error.message : '保存失败，请稍后重试。'
  } finally {
    if (version === saveGeneration) saving.value = false
  }
}

watch([todayTitles, today, anniversariesLoading], () => { void celebrateToday() }, { flush: 'post' })
watch(identity, () => {
  saveGeneration++; saving.value = false; formError.value = ''; notice.value = ''
  celebrated.clear(); stopCelebration(); editor.value?.close()
}, { flush: 'sync' })
onMounted(() => { mounted = true; void celebrateToday() })
onBeforeUnmount(() => { mounted = false; saveGeneration++; stopCelebration(); editor.value?.close() })
</script>

<template>
  <section id="next-anniversary-card" class="love-glass home-anniversary" aria-labelledby="anniversary-card-heading" :aria-busy="anniversariesLoading">
    <header class="home-anniversary__header">
      <div><span class="home-anniversary__eyebrow"><CalendarHeart :size="16" aria-hidden="true" />下一份期待</span><h2 id="anniversary-card-heading" class="home-anniversary__title">下一个纪念日</h2></div>
      <button id="new-anniversary-button" class="home-anniversary__add" type="button" :disabled="saving || anniversariesLoading" @click="openEditor"><Plus :size="17" aria-hidden="true" /><span>新增纪念日</span></button>
    </header>
    <p v-if="anniversariesLoading" class="home-anniversary__loading" role="status"><LoaderCircle class="home-anniversary__spinner" :size="18" aria-hidden="true" />正在寻找下一份期待…</p>
    <div v-else-if="errorMessage" class="home-anniversary__error" role="alert"><p>{{ errorMessage }}</p><button type="button" @click="loadAnniversaries">重新加载</button></div>
    <div v-else-if="todayTitles" class="home-anniversary__celebration">
      <Sparkles :size="30" aria-hidden="true" />
      <h3 id="anniversary-today-message">今天是我们的 {{ todayTitles }}，<span class="whitespace-nowrap">快乐！</span></h3>
      <p>把今天过成，值得反复想起的一天。</p>
    </div>
    <div v-else-if="nextAnniversary" class="home-anniversary__countdown">
      <p class="home-anniversary__lead">距离 <strong id="anniversary-next-title">{{ nextAnniversary.title }}</strong> 还有</p>
      <p class="home-anniversary__number"><strong id="anniversary-days">{{ nextAnniversary.daysRemaining }}</strong><span>天</span></p>
      <p class="home-anniversary__date">{{ nextAnniversary.nextDate }}<span v-if="nextAnniversary.recurring"> · 每年一起纪念</span></p>
    </div>
    <div v-else class="home-anniversary__empty"><p>下一份期待，等我们一起写下。</p><span>生日、第一次旅行，或只有你们知道的特别日子。</span></div>
    <p v-if="notice" class="home-anniversary__notice" role="status">{{ notice }}</p>
  </section>

  <dialog id="anniversary-editor" ref="editor" class="love-glass home-anniversary-dialog" aria-labelledby="anniversary-editor-title" @cancel.prevent="closeEditor">
    <header><div><p class="home-anniversary__eyebrow">SOMETHING TO LOOK FORWARD TO</p><h2 id="anniversary-editor-title">新增纪念日</h2></div><button class="home-anniversary__close" type="button" aria-label="关闭纪念日表单" :disabled="saving" @click="closeEditor"><X :size="21" aria-hidden="true" /></button></header>
    <form :aria-busy="saving" @submit.prevent="save">
      <fieldset :disabled="saving">
        <label for="anniversary-title"><span>纪念日名称</span><input id="anniversary-title" ref="titleInput" v-model="form.title" type="text" required maxlength="80" placeholder="比如：第一次见面纪念日"></label>
        <label for="anniversary-date"><span>日期</span><input id="anniversary-date" v-model="form.date" type="date" required min="0001-01-01" max="9999-12-31"></label>
        <label class="home-anniversary__repeat" for="anniversary-repeat"><input id="anniversary-repeat" v-model="form.repeat" type="checkbox"><span>每年重复，一起纪念</span></label>
        <p class="home-anniversary__help">倒计时按北京时间计算。单次纪念日过期后不再计入；2 月 29 日在非闰年按 2 月 28 日纪念。</p>
      </fieldset>
      <p v-if="formError" class="home-anniversary__error" role="alert">{{ formError }}</p>
      <footer><button class="home-anniversary__cancel" type="button" :disabled="saving" @click="closeEditor">取消</button><button class="home-anniversary__save" type="submit" :disabled="saving"><LoaderCircle v-if="saving" :size="18" class="home-anniversary__spinner" aria-hidden="true" />{{ saving ? '正在保存…' : '保存纪念日' }}</button></footer>
    </form>
  </dialog>
</template>
