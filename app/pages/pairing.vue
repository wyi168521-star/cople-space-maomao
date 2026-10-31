<script setup lang="ts">
import { CalendarHeart, Heart, Link2, LoaderCircle, LogOut, RefreshCw, Sparkles, UserRound } from '@lucide/vue'
import GlassCard from '../components/ui/GlassCard.vue'
import SpaceInviteLink from '../components/SpaceInviteLink.vue'
import { inviteAuthPath, normalizeCoupleId } from '../utils/pairingInvite'
import '../styles/auth-flow.css'

useHead({ title: '一起安家 · Love小家' })

const { profile, stage, initialized, loading, membershipLoading, authError, createSpace, joinSpace, refreshMembership, signOut, authRedirect } = useAuth()
const route = useRoute()
const inviteId = computed(() => normalizeCoupleId(route.query.invite))
const invalidInvite = computed(() => route.query.invite !== undefined && !inviteId.value)
const mode = ref<'create' | 'join'>('create')
const nameA = ref(profile.value?.displayName || '')
const nameB = ref('')
const today = new Date()
const startDate = ref(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`)
const coupleId = ref('')
const pageError = ref('')
const pending = ref(false)
const signingOut = ref(false)
const busy = computed(() => pending.value || loading.value || membershipLoading.value || !initialized.value)
const membershipFailed = computed(() => stage.value === 'membership-error')

watch(() => route.query.invite, value => {
  if (value === undefined) return
  mode.value = 'join'; coupleId.value = normalizeCoupleId(value); pageError.value = ''
}, { immediate: true })

watch([initialized, stage, () => route.query.invite], ([ready]) => {
  if (!ready) return
  const redirect = authRedirect(route.path, route.query.invite)
  if (redirect) void navigateTo(redirect, { replace: true })
}, { immediate: true })

function changeMode(next: 'create' | 'join') {
  mode.value = next
  pageError.value = ''
}

function onTabKey(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const next = event.key === 'Home' ? 'create' : event.key === 'End' ? 'join' : mode.value === 'create' ? 'join' : 'create'
  changeMode(next)
  nextTick(() => document.getElementById(`pair-tab-${next}`)?.focus())
}

async function submit() {
  if (busy.value || stage.value !== 'unpaired') return
  pageError.value = ''
  const normalizedId = coupleId.value.trim()
  if (mode.value === 'create' && (!nameA.value.trim() || !nameB.value.trim() || !startDate.value)) {
    pageError.value = '请填写两个人的称呼和在一起的日期。'
    return
  }
  if (mode.value === 'join' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalizedId)) {
    pageError.value = '空间编号格式不正确，请粘贴对方首页的完整编号。'
    return
  }
  pending.value = true
  try {
    if (mode.value === 'create') await createSpace(nameA.value.trim(), nameB.value.trim(), startDate.value)
    else await joinSpace(normalizedId)
    // 创建后留在配对页展示邀请；加入成功后进入首页。
    if (mode.value === 'join') await navigateTo('/', { replace: true })
  } catch (error) {
    pageError.value = authError.value || (error instanceof Error ? error.message : '暂时无法完成操作，请稍后再试。')
  } finally {
    pending.value = false
  }
}

async function retryMembership() {
  if (busy.value) return
  pending.value = true
  pageError.value = ''
  try {
    await refreshMembership()
  } catch (error) {
    pageError.value = authError.value || (error instanceof Error ? error.message : '仍然无法读取空间，请稍后重试。')
  } finally {
    pending.value = false
  }
}

async function leaveAccount() {
  if (busy.value) return
  signingOut.value = true
  pending.value = true
  pageError.value = ''
  try {
    await signOut()
    await navigateTo(inviteAuthPath('/login', route.query.invite), { replace: true })
  } catch (error) {
    pageError.value = authError.value || (error instanceof Error ? error.message : '退出失败，请稍后再试。')
  } finally {
    pending.value = false
    signingOut.value = false
  }
}
</script>

<template>
  <main class="love-flow love-flow--centered">
    <div class="love-flow__centered-layout">
      <div class="love-flow__brand love-flow__brand--center"><span><Heart :size="22" fill="currentColor" aria-hidden="true" /></span>Love小家</div>
      <GlassCard as="section" padding="lg" class="love-flow__card love-flow__card--wide" aria-labelledby="pair-heading" :aria-busy="busy">
        <template v-if="stage === 'paired'">
          <span class="love-flow__icon"><Heart :size="28" aria-hidden="true" /></span>
          <p class="love-flow__eyebrow">小家已经准备好了</p>
          <h1 id="pair-heading">邀请另一半，<br>一起回家。</h1>
          <p v-if="inviteId && inviteId !== profile?.coupleId" class="love-flow__notice" role="status">你已经加入一个小家，不能重复加入其他空间。</p>
          <p v-else-if="inviteId" class="love-flow__success" role="status">你已经在这个小家啦，可以直接回到首页。</p>
          <p v-if="invalidInvite" class="love-flow__notice" role="status">收到的邀请链接无效。下方是你当前小家的邀请链接。</p>
          <p class="love-flow__description">分享专属链接，让两个人的故事从这里继续。<br>一个空间，刚好容纳两个人。</p>
          <SpaceInviteLink v-if="profile?.coupleId" :couple-id="profile.coupleId" />
          <NuxtLink to="/" class="love-flow__secondary love-flow__invite-home">进入我们的小家</NuxtLink>
        </template>
        <template v-else-if="membershipFailed">
          <span class="love-flow__icon"><RefreshCw :size="27" aria-hidden="true" /></span>
          <p class="love-flow__eyebrow">再试一次</p>
          <h1 id="pair-heading">暂时无法读取你的小家</h1>
          <p class="love-flow__description">我们还没能确认你所在的空间。重新读取后，就可以继续了。</p>
          <p class="love-flow__error" role="alert">{{ pageError || authError || '空间信息加载失败，请检查网络后重试。' }}</p>
          <button class="love-flow__primary" type="button" :disabled="busy" @click="retryMembership"><LoaderCircle v-if="busy" :size="18" class="love-flow__spinner" aria-hidden="true" /><RefreshCw v-else :size="18" aria-hidden="true" />{{ busy ? '正在读取…' : '重新读取空间' }}</button>
        </template>

        <template v-else>
          <p class="love-flow__eyebrow">你好，{{ profile?.displayName || '新朋友' }}</p>
          <h1 id="pair-heading">给我们的故事，安个家。</h1>
          <p class="love-flow__description">创建一个新空间，或加入对方的小家。<br>一个空间，刚好容纳两个人。</p>
          <p v-if="inviteId && mode === 'join'" class="love-flow__notice" role="status">你收到一份专属小家邀请，空间编号已自动填好。确认后就能加入。</p>
          <p v-else-if="invalidInvite" class="love-flow__notice" role="status">邀请链接中的空间编号无效，请向对方重新获取链接，或手动填写正确编号。</p>
          <div class="love-flow__tabs" role="tablist" aria-label="选择配对方式" @keydown="onTabKey">
            <button id="pair-tab-create" type="button" role="tab" aria-controls="pair-panel" :aria-selected="mode === 'create'" :tabindex="mode === 'create' ? 0 : -1" :disabled="busy" @click="changeMode('create')"><Sparkles :size="17" aria-hidden="true" />创建空间</button>
            <button id="pair-tab-join" type="button" role="tab" aria-controls="pair-panel" :aria-selected="mode === 'join'" :tabindex="mode === 'join' ? 0 : -1" :disabled="busy" @click="changeMode('join')"><Link2 :size="17" aria-hidden="true" />加入空间</button>
          </div>

          <form id="pair-panel" class="love-flow__form" role="tabpanel" :aria-labelledby="`pair-tab-${mode}`" @submit.prevent="submit">
            <fieldset :disabled="busy || stage !== 'unpaired'">
              <template v-if="mode === 'create'">
                <div class="love-flow__field">
                  <label for="pair-name-a">你的称呼</label>
                  <div class="love-flow__input-wrap"><UserRound :size="18" aria-hidden="true" /><input id="pair-name-a" v-model="nameA" name="nameA" autocomplete="nickname" maxlength="40" placeholder="例如：小林" required></div>
                </div>
                <div class="love-flow__field">
                  <label for="pair-name-b">另一半的称呼</label>
                  <div class="love-flow__input-wrap"><Heart :size="18" aria-hidden="true" /><input id="pair-name-b" v-model="nameB" name="nameB" maxlength="40" placeholder="例如：小夏" required></div>
                </div>
                <div class="love-flow__field">
                  <label for="pair-start-date">在一起的日期</label>
                  <div class="love-flow__input-wrap"><CalendarHeart :size="18" aria-hidden="true" /><input id="pair-start-date" v-model="startDate" name="startDate" type="date" required></div>
                </div>
                <p class="love-flow__hint">创建后，这里会生成专属邀请链接，可以直接分享给另一半。</p>
              </template>
              <div v-else class="love-flow__field">
                <label for="pair-couple-id">对方的空间编号</label>
                <div class="love-flow__input-wrap"><Link2 :size="18" aria-hidden="true" /><input id="pair-couple-id" v-model="coupleId" name="coupleId" type="text" autocomplete="off" autocapitalize="none" :spellcheck="false" maxlength="36" aria-describedby="couple-id-hint" placeholder="粘贴完整空间编号" required></div>
                <small id="couple-id-hint" class="love-flow__hint">请对方从首页复制编号，再原样粘贴到这里。</small>
              </div>
              <p v-if="pageError" class="love-flow__error" role="alert">{{ pageError }}</p>
              <button class="love-flow__primary" type="submit" :disabled="busy || stage !== 'unpaired'"><LoaderCircle v-if="busy" :size="18" class="love-flow__spinner" aria-hidden="true" />{{ busy ? '请稍候…' : mode === 'create' ? '创建我们的小家' : inviteId && normalizeCoupleId(coupleId) === inviteId ? '确认加入这个小家' : '加入对方的小家' }}</button>
            </fieldset>
          </form>
        </template>
        <div class="love-flow__account-footer"><span>{{ profile?.email || '当前账户' }}</span><button class="love-flow__text-button" type="button" :disabled="busy" @click="leaveAccount"><LogOut :size="16" aria-hidden="true" />{{ signingOut ? '正在退出…' : '退出登录' }}</button></div>
      </GlassCard>
      <p class="love-flow__outside-note">愿每一件小事，都有人一起记得。</p>
    </div>
  </main>
</template>
