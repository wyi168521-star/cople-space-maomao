<script setup lang="ts">
import { Heart, KeyRound, LoaderCircle, Mail, RefreshCw, ShieldCheck, UserRound } from '@lucide/vue'
import GlassCard from '../components/ui/GlassCard.vue'
import { clearSupabaseLocalSession } from '../lib/supabase'
import { normalizeCoupleId } from '../utils/pairingInvite'
import '../styles/auth-flow.css'

useHead({ title: '登录 · Love小家' })

const { configured, user, stage, initialized, loading, membershipLoading, authError, initializationError, retryInitialization, disposeSession, signIn, signUp, resendConfirmation, authRedirect } = useAuth()
const config = useRuntimeConfig()
const route = useRoute()
const inviteId = computed(() => normalizeCoupleId(route.query.invite))
const invalidInvite = computed(() => route.query.invite !== undefined && !inviteId.value)
const mode = ref<'login' | 'signup'>('login')
const displayName = ref('')
const email = ref('')
const password = ref('')
const signupEmail = ref('')
const confirmationDismissed = ref(false)
const pageError = ref(authError.value || '')
const resendStatus = ref('')
const recoveryError = ref('')
const pending = ref(false)
const busy = computed(() => pending.value || loading.value || !initialized.value)
const awaitingConfirmation = computed(() => !confirmationDismissed.value && !user.value && (stage.value === 'awaiting-confirmation' || !!signupEmail.value))

watch(authError, (message, previous) => {
  if (message || pageError.value === previous) pageError.value = message
})
watch([initialized, stage, membershipLoading, () => route.query.invite], ([ready]) => {
  if (!ready || membershipLoading.value) return
  const redirect = authRedirect(route.path, route.query.invite)
  if (redirect) void navigateTo(redirect, { replace: true })
}, { immediate: true })

function changeMode(next: 'login' | 'signup') {
  mode.value = next
  pageError.value = ''
  resendStatus.value = ''
  password.value = ''
}

function onTabKey(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const next = event.key === 'Home' ? 'login' : event.key === 'End' ? 'signup' : mode.value === 'login' ? 'signup' : 'login'
  changeMode(next)
  nextTick(() => document.getElementById(`auth-tab-${next}`)?.focus())
}

async function submit() {
  if (busy.value || !configured.value || initializationError.value) return
  pageError.value = ''
  resendStatus.value = ''
  const normalizedEmail = email.value.trim()
  if (!normalizedEmail || !password.value || (mode.value === 'signup' && !displayName.value.trim())) {
    pageError.value = '请填写完整信息后再继续。'
    return
  }
  pending.value = true
  try {
    if (mode.value === 'signup') {
      await signUp(displayName.value.trim(), normalizedEmail, password.value, route.query.invite)
      if (!user.value) {
        signupEmail.value = normalizedEmail
        confirmationDismissed.value = false
        password.value = ''
      }
    } else {
      await signIn(normalizedEmail, password.value)
    }
  } catch (error) {
    pageError.value = authError.value || (error instanceof Error ? error.message : '暂时无法完成操作，请稍后再试。')
  } finally {
    pending.value = false
  }
}

async function resendEmail() {
  if (busy.value || !configured.value) return
  pending.value = true
  pageError.value = ''
  resendStatus.value = ''
  try {
    await resendConfirmation(signupEmail.value || email.value.trim(), route.query.invite)
    resendStatus.value = '确认邮件已重新发送，请查看收件箱和垃圾邮件。'
  } catch (error) {
    pageError.value = authError.value || (error instanceof Error ? error.message : '邮件发送失败，请稍后再试。')
  } finally {
    pending.value = false
  }
}

function returnToLogin() {
  confirmationDismissed.value = true
  changeMode('login')
}

async function retrySession() {
  if (busy.value) return
  pending.value = true
  pageError.value = ''
  recoveryError.value = ''
  try { await retryInitialization() }
  catch (error) { pageError.value = error instanceof Error ? error.message : '登录状态检查失败，请稍后重试。' }
  finally { pending.value = false }
}

function resetLocalSession() {
  if (busy.value) return
  recoveryError.value = ''
  try {
    // Only this Supabase project's browser credentials are removed. Reloading
    // preserves the invitation URL and starts a fresh SDK instance.
    clearSupabaseLocalSession(String(config.public.supabaseUrl || ''))
    disposeSession()
    window.location.reload()
  } catch {
    recoveryError.value = '无法清除本机登录状态，请允许浏览器访问本站存储后重试。'
  }
}
</script>

<template>
  <main class="love-flow love-flow--auth">
    <div class="love-flow__layout">
      <section class="love-flow__intro" aria-labelledby="welcome-heading">
        <div class="love-flow__brand"><span><Heart :size="22" fill="currentColor" aria-hidden="true" /></span>Love小家</div>
        <p class="love-flow__eyebrow">两个人，一起慢慢来</p>
        <h1 id="welcome-heading">把喜欢的日常，<br>留在我们的小家。</h1>
        <p class="love-flow__intro-copy">从一句晚安，到每一个值得纪念的日子。<br>让两个人的故事，有一个共同的归处。</p>
        <div class="love-flow__keepsake" aria-hidden="true">
          <span class="love-flow__little-heart">♡</span>
          <span>今天，也有好好想你。</span>
          <span class="love-flow__keepsake-date">OUR LITTLE MOMENTS</span>
        </div>
        <p class="love-flow__intro-footer"><ShieldCheck :size="17" aria-hidden="true" /> 一个空间，最多两位成员</p>
      </section>

      <GlassCard as="section" padding="lg" class="love-flow__card" aria-labelledby="auth-heading" :aria-busy="busy">
        <p v-if="inviteId" class="love-flow__notice" role="status">你收到一份小家邀请，登录或注册后即可确认加入。</p>
        <p v-else-if="invalidInvite" class="love-flow__notice" role="status">这份邀请链接无效，请向对方重新获取链接；也可以登录后手动加入空间。</p>
        <template v-if="awaitingConfirmation">
          <span class="love-flow__icon"><Mail :size="28" aria-hidden="true" /></span>
          <p class="love-flow__eyebrow">只差一步</p>
          <h2 id="auth-heading">去邮箱确认一下吧</h2>
          <p class="love-flow__description">确认邮件已发送<span v-if="signupEmail || email">至 <strong class="love-flow__email">{{ signupEmail || email }}</strong></span>。请打开邮件中的链接，确认后即可继续。</p>
          <p class="love-flow__hint">没有找到？也可以查看垃圾邮件，或重新发送一封。</p>
          <p v-if="resendStatus" class="love-flow__success" role="status">{{ resendStatus }}</p>
          <p v-if="pageError" class="love-flow__error" role="alert">{{ pageError }}</p>
          <button class="love-flow__primary" type="button" :disabled="busy || !configured || !(signupEmail || email)" @click="resendEmail">
            <LoaderCircle v-if="busy" :size="18" class="love-flow__spinner" aria-hidden="true" />{{ busy ? '正在发送…' : '重新发送确认邮件' }}
          </button>
          <button class="love-flow__text-button" type="button" :disabled="busy" @click="returnToLogin">已经确认？返回登录</button>
        </template>

        <template v-else>
          <p class="love-flow__eyebrow">{{ mode === 'login' ? '欢迎回来' : '故事从这里开始' }}</p>
          <h2 id="auth-heading">{{ mode === 'login' ? '回到我们的小家' : '创建你的账户' }}</h2>
          <p class="love-flow__description">{{ mode === 'login' ? '登录后，继续收藏两个人的日常。' : '先认识你，再一起创建专属空间。' }}</p>

          <div class="love-flow__tabs" role="tablist" aria-label="账户操作" @keydown="onTabKey">
            <button id="auth-tab-login" type="button" role="tab" aria-controls="auth-panel" :aria-selected="mode === 'login'" :tabindex="mode === 'login' ? 0 : -1" :disabled="busy" @click="changeMode('login')">登录</button>
            <button id="auth-tab-signup" type="button" role="tab" aria-controls="auth-panel" :aria-selected="mode === 'signup'" :tabindex="mode === 'signup' ? 0 : -1" :disabled="busy" @click="changeMode('signup')">注册</button>
          </div>

          <p v-if="!configured" class="love-flow__notice" role="status">登录服务暂时不可用，请稍后再试。</p>
          <p v-if="!initialized" class="love-flow__notice" role="status">正在恢复登录状态，请稍候…</p>
          <div v-else-if="initializationError" class="love-flow__error" role="alert">
            <strong>登录状态检查失败</strong>
            <p>{{ initializationError }}</p>
            <button class="love-flow__text-button" type="button" :disabled="busy || !configured" @click="retrySession"><RefreshCw :size="16" aria-hidden="true" />重新检查登录状态</button>
            <button class="love-flow__text-button" type="button" :disabled="busy || !configured" @click="resetLocalSession">清除本机登录状态并重新登录</button>
            <p v-if="recoveryError" role="status">{{ recoveryError }}</p>
          </div>
          <form id="auth-panel" class="love-flow__form" role="tabpanel" :aria-labelledby="`auth-tab-${mode}`" @submit.prevent="submit">
            <fieldset :disabled="busy || !configured || !!initializationError">
              <div v-if="mode === 'signup'" class="love-flow__field">
                <label for="auth-display-name">你的称呼</label>
                <div class="love-flow__input-wrap"><UserRound :size="18" aria-hidden="true" /><input id="auth-display-name" v-model="displayName" name="displayName" autocomplete="nickname" maxlength="40" placeholder="希望对方怎么称呼你" required></div>
              </div>
              <div class="love-flow__field">
                <label for="auth-email">邮箱</label>
                <div class="love-flow__input-wrap"><Mail :size="18" aria-hidden="true" /><input id="auth-email" v-model="email" name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="none" :spellcheck="false" placeholder="name@example.com" required></div>
              </div>
              <div class="love-flow__field">
                <label for="auth-password">密码</label>
                <div class="love-flow__input-wrap"><KeyRound :size="18" aria-hidden="true" /><input id="auth-password" v-model="password" name="password" type="password" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" :minlength="mode === 'signup' ? 6 : undefined" :aria-describedby="mode === 'signup' ? 'password-hint' : undefined" placeholder="请输入密码" required></div>
                <small v-if="mode === 'signup'" id="password-hint" class="love-flow__hint">至少 6 位，建议使用独立且不易猜测的密码。</small>
              </div>
              <p v-if="pageError && !initializationError" class="love-flow__error" role="alert">{{ pageError }}</p>
              <button class="love-flow__primary" type="submit" :disabled="busy || !configured || !!initializationError">
                <LoaderCircle v-if="busy" :size="18" class="love-flow__spinner" aria-hidden="true" />{{ busy ? '请稍候…' : mode === 'login' ? '登录 Love小家' : '创建账户' }}
              </button>
            </fieldset>
          </form>
          <p class="love-flow__footnote"><Heart :size="14" aria-hidden="true" /> 留给彼此的，慢慢记录。</p>
        </template>
      </GlassCard>
    </div>
  </main>
</template>
