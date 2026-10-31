<script setup lang="ts">
import { Check, Copy, Heart, Images, LoaderCircle, LogOut, MessageCircleHeart } from '@lucide/vue'
import GlassCard from '../components/ui/GlassCard.vue'
import HomeAnniversaryCard from '../components/HomeAnniversaryCard.vue'
import HomeDashboard from '../components/HomeDashboard.vue'
import LoveDuration from '../components/LoveDuration.vue'
import HomeLoveQuote from '../components/HomeLoveQuote.vue'
import { useAI } from '../composables/useAI'
import { homepageQuoteInput } from '../utils/aiPresentation'
import '../styles/auth-flow.css'
import '../styles/ai-features.css'

useHead({ title: '我们的小家 · Love小家' })

const { user, profile, stage, initialized, loading, authError, signOut } = useAuth()
const { loveQuote, quoteLoading, quoteIsFallback, quoteNotice, fetchLoveQuote } = useAI()
let quoteMounted = false
let quoteContext = ''
function loadQuote(force = false) {
  const member = profile.value
  if (!quoteMounted || !user.value?.id || !member?.coupleId || quoteLoading.value) return
  const context = JSON.stringify([user.value.id, member.coupleId, member.nameA, member.nameB, member.startDate])
  if (!force && quoteContext === context) return
  quoteContext = context
  void fetchLoveQuote(homepageQuoteInput(member.nameA || '', member.nameB || '', member.startDate || ''))
}
watch([() => user.value?.id, () => profile.value?.coupleId, () => profile.value?.nameA,
  () => profile.value?.nameB, () => profile.value?.startDate], () => loadQuote(), { flush: 'post' })
onMounted(() => { quoteMounted = true; loadQuote() })
onBeforeUnmount(() => { quoteMounted = false })
const pending = ref(false)
const pageError = ref('')
const copyStatus = ref('')
const copied = ref(false)
const copying = ref(false)
const idInput = ref<HTMLTextAreaElement | null>(null)
const coupleId = computed(() => profile.value?.coupleId || '')
const busy = computed(() => pending.value || loading.value)

watch([initialized, stage], ([ready, nextStage]) => {
  if (!ready) return
  if (nextStage === 'signed-out' || nextStage === 'awaiting-confirmation') void navigateTo('/login', { replace: true })
  if (nextStage === 'unpaired' || nextStage === 'membership-error') void navigateTo('/pairing', { replace: true })
}, { immediate: true })

async function copyId() {
  if (!coupleId.value || copying.value) return
  copying.value = true
  copied.value = false
  copyStatus.value = ''
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
    await navigator.clipboard.writeText(coupleId.value)
    copied.value = true
    copyStatus.value = '空间编号已复制，可以分享给另一半了。'
  } catch {
    idInput.value?.focus()
    idInput.value?.select()
    copyStatus.value = '暂时无法自动复制，请长按或选中上方编号复制。'
  } finally {
    copying.value = false
  }
}

async function leaveAccount() {
  if (busy.value) return
  pending.value = true
  pageError.value = ''
  try {
    await signOut()
    await navigateTo('/login', { replace: true })
  } catch (error) {
    pageError.value = authError.value || (error instanceof Error ? error.message : '退出失败，请稍后再试。')
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <main class="love-flow love-flow--home">
    <div class="love-flow__home-layout">
      <header class="love-flow__home-header">
        <div class="love-flow__brand"><span><Heart :size="22" fill="currentColor" aria-hidden="true" /></span>Love小家</div>
        <button class="love-flow__secondary love-flow__signout" type="button" :disabled="busy" @click="leaveAccount"><LoaderCircle v-if="busy" :size="17" class="love-flow__spinner" aria-hidden="true" /><LogOut v-else :size="17" aria-hidden="true" />{{ busy ? '正在退出…' : '退出登录' }}</button>
      </header>
      <HomeAnniversaryCard />
      <GlassCard as="section" padding="lg" class="love-flow__home-card" aria-labelledby="home-heading" :aria-busy="busy">
        <span class="love-flow__icon"><Heart :size="30" fill="currentColor" aria-hidden="true" /></span>
        <p class="love-flow__eyebrow">欢迎回家，{{ profile?.displayName || '亲爱的' }}</p>
        <h1 id="home-heading">{{ profile?.nameA && profile?.nameB ? `${profile.nameA} & ${profile.nameB}` : '我们的小家' }}</h1>
        <p class="love-flow__description">两个人的故事，从这里继续。</p>
        <p v-if="profile?.startDate" class="love-flow__date">从 {{ profile.startDate }} 开始，把普通日子过成纪念日。</p>
        <LoveDuration v-if="profile?.startDate" :start="profile.startDate" layout="inline" class="love-home-duration" />
        <HomeLoveQuote :text="loveQuote" :loading="quoteLoading" :is-fallback="quoteIsFallback" :notice="quoteNotice" @retry="loadQuote(true)" />
        <HomeDashboard />
        <nav class="flex flex-wrap gap-3" aria-label="小家导航">
          <NuxtLink to="/timeline" class="love-flow__secondary" style="text-decoration: none;">打开我们的时光轴</NuxtLink>
          <NuxtLink to="/whispers" class="love-flow__secondary" style="text-decoration: none;"><MessageCircleHeart :size="18" aria-hidden="true" />悄悄话</NuxtLink>
          <NuxtLink to="/albums" class="love-flow__secondary" style="text-decoration: none;"><Images :size="18" aria-hidden="true" />相册</NuxtLink>
        </nav>

        <div class="love-flow__space-box">
          <label for="home-couple-id">空间编号 <span>couple_id</span></label>
          <p>把这个编号分享给另一半，TA 登录后就可以加入。</p>
          <textarea id="home-couple-id" ref="idInput" class="love-flow__space-id" :value="coupleId" readonly rows="2" aria-describedby="space-id-description" @focus="idInput?.select()" />
          <span id="space-id-description" class="love-flow__hint">请完整复制，包括编号中的连字符。</span>
          <button class="love-flow__primary" type="button" :disabled="!coupleId || copying || busy" @click="copyId"><Check v-if="copied" :size="18" aria-hidden="true" /><Copy v-else :size="18" aria-hidden="true" />{{ copied ? '已复制空间编号' : '复制空间编号' }}</button>
          <p class="love-flow__copy-status" role="status" aria-live="polite">{{ copyStatus }}</p>
        </div>
        <p v-if="pageError" class="love-flow__error" role="alert">{{ pageError }}</p>
        <p class="love-flow__footnote">当前登录：{{ profile?.email || profile?.displayName }}</p>
      </GlassCard>
      <p class="love-flow__outside-note">小家已就绪，接下来是我们一起的每一天。</p>
    </div>
  </main>
</template>
