<script setup lang="ts">
import CallScreen from './components/CallScreen.vue'
import AppShell from './components/layout/AppShell.vue'
import Loading from './components/ui/Loading.vue'
import EmptyState from './components/ui/EmptyState.vue'
import type { NavigationItem } from './types/navigation'
import {
  CalendarDays,
  Activity,
  Check,
  ChevronRight,
  Heart,
  Home,
  Image,
  ListChecks,
  MapPin,
  MessageCircleHeart,
  Camera,
  X,
  Plus,
  Settings,
  Sparkles,
  History,
  BrainCircuit,
  PawPrint,
  Radio,
  StopCircle,
  Volume2,
  VolumeX,
  WifiOff,
  RefreshCw,
  Bell,
} from '@lucide/vue'
import { notifySystem, requestSystemAlerts } from './composables/useSystemAlerts'
import { createMediaSignedUrl, refreshMediaElement, revealVideoFrame } from './composables/useMediaUrls'

const navItems: NavigationItem[] = [
  { label: '首页', icon: Home },
  { label: '时光', icon: History },
  { label: '相册', icon: Image },
  { label: '清单', icon: ListChecks },
  { label: '纪念日', icon: CalendarDays },
  { label: '悄悄话', icon: MessageCircleHeart },
  { label: '心动AI', icon: BrainCircuit },
  { label: '宠物小屋', icon: PawPrint },
]

const activeNav = ref('首页')
const pageError = ref('')
const pageRenderKey = ref(0)
const isOffline = ref(false)
const timelineRef = ref<{ openCreate: () => void } | null>(null)
const authVisible = ref(true)
const appReady = ref(false)
const accountVisible = ref(false)
const spaceStatusVisible = ref(false)
const notificationVisible = ref(false)
const firstRunIntroVisible = ref(false)
const firstRunChecklistVisible = ref(false)
const chatVisible = ref(false)
const messageToast = ref<{ sender: string; content: string } | null>(null)
let messageToastTimer: ReturnType<typeof setTimeout> | undefined
const coverPickerVisible = ref(false)
const selectedCoverPath = ref('')
const selectedCoverUrl = ref('')
const displayedHeroPhoto = ref('')
const heroPhotoShape = ref<'wide' | 'square' | 'portrait'>('wide')
const { stage, profile, initialize, signOut } = useAuth()
const { anniversaries, relationshipStart, loveDays, nextAnniversary, loadAnniversaries } = useAnniversaries()
const { sync: syncAnniversaryReminders } = useAnniversaryReminders()
const { memories, loadMemories } = useMemories()
const { allPhotos, loadAlbums, subscribeAlbumPhotos, disconnectAlbumPhotos } = useAlbums()
const { items: togetherItems, loadItems, toggleItem } = useTogetherList()
const { members, loadMembers, subscribeMembers, disconnectMembers } = useAccountManagement()
const { partnerOnline, connectPresence, disconnectPresence } = useCouplePresence()
const { messages, unreadCount, loadMessages, subscribe: subscribeMessages, markRead, disconnect: disconnectMessages } = useMessages()
const { callStatus, ensureChannel: ensureCallChannel, disconnectCall } = useCoupleCall()
const { liveStatus, liveError, liveRemoteMuted, liveRemoteName, liveNeedsGesture, ensureLiveChannel, stopLive, dismissLive, resumeLiveAudio, disconnectLive } = useCoupleLiveMic()
const { register: registerPushNotifications } = usePushNotifications()
const { notifications, unreadCount: notificationUnreadCount, aiLoading: notificationAiLoading, refreshAiWorks, markRead: markNotificationRead, markAllRead: markAllNotificationsRead } = useNotificationCenter()
const { $supabase } = useNuxtApp()
let pairedBootstrapStarted = false

function settleWithin<T>(promise: Promise<T>, timeout = 7000) {
  return Promise.race([
    promise,
    new Promise<T | undefined>(resolve => globalThis.setTimeout(() => resolve(undefined), timeout)),
  ])
}

const latestMemory = computed(() => memories.value[0] || null)
const latestSharedMoment = computed(() => {
  const photo = allPhotos.value[0]
  if (!photo) return null
  const memory = photo.source === 'memory'
    ? memories.value.find(item => item.photos.some(itemPhoto => itemPhoto.path === photo.path || itemPhoto.url === photo.url))
    : null
  return {
    photoUrl: photo.url,
    date: photo.takenDate,
    title: memory?.content.slice(0, 28) || photo.caption || photo.albumName || '新加入的共同照片',
    description: memory?.content || photo.caption || `收录在「${photo.albumName || '我们的相册'}」中`,
    location: memory?.location || '',
    source: photo.source === 'memory' ? '时光记录' : '相册照片',
  }
})
const homeHeroPhoto = computed(() => selectedCoverUrl.value || latestMemory.value?.photos[0]?.url || allPhotos.value[0]?.url || '')
const homeHeroPath = computed(() => selectedCoverPath.value || latestMemory.value?.photos[0]?.path || allPhotos.value[0]?.path || '')
const homeHeroLocation = computed(() => latestMemory.value?.photos[0]
  ? latestMemory.value.location
  : allPhotos.value[0]?.albumName || '')
const homePlans = computed(() => togetherItems.value.slice(0, 3))
const completedPlanCount = computed(() => togetherItems.value.filter(item => item.completed).length)
const selfMember = computed(() => members.value.find(member => member.id === profile.value?.id) || members.value[0])
const partnerMember = computed(() => members.value.find(member => member.id !== profile.value?.id))
const coupleNames = computed(() => partnerMember.value ? `${selfMember.value?.displayName || profile.value?.displayName} 与 ${partnerMember.value.displayName}` : selfMember.value?.displayName || profile.value?.displayName || '我们的空间')
const todayLabel = computed(() => new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date()))
const relationshipLabel = computed(() => new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(`${relationshipStart.value}T12:00:00`)))
const nextOccurrence = computed(() => nextAnniversary.value ? occurrence(nextAnniversary.value) : null)

watch(homeHeroPhoto, value => {
  if (!import.meta.client || !value) return
  const image = new window.Image()
  image.onload = () => {
    const ratio = image.naturalWidth / image.naturalHeight
    heroPhotoShape.value = ratio >= 1.4 ? 'wide' : ratio <= .82 ? 'portrait' : 'square'
    displayedHeroPhoto.value = value
  }
  image.src = value
}, { immediate: true })

async function loadHomeData() {
  // Keep network stalls from blocking the shell. Each source can finish and
  // update its own view independently while the home screen is already usable.
  await Promise.allSettled([
    loadAnniversaries(),
    loadMemories(),
    loadAlbums(),
    loadItems(),
    loadMembers(),
  ].map(task => settleWithin(task)))
  await Promise.allSettled([
    subscribeMembers(),
    subscribeAlbumPhotos(),
    syncAnniversaryReminders(anniversaries.value),
    loadCoupleCover(),
    connectPresence(),
    loadMessages(),
    subscribeMessages(),
  ].map(task => settleWithin(task)))
}

function startPairedBootstrap() {
  if (pairedBootstrapStarted) return
  pairedBootstrapStarted = true
  void loadHomeData().catch(() => undefined)
  void settleWithin(ensureCallChannel().catch(() => undefined), 5000)
  void settleWithin(ensureLiveChannel().catch(() => undefined), 5000)
  void registerPushNotifications()
}

function maybeShowFirstRunChecklist() {
  if (!import.meta.client || firstRunIntroVisible.value || stage.value !== 'paired') return
  if (localStorage.getItem('couple-space-first-run-complete') !== '1') firstRunChecklistVisible.value = true
}

function completeFirstRunIntro() {
  if (import.meta.client) localStorage.setItem('couple-space-first-run-intro', '1')
  firstRunIntroVisible.value = false
  maybeShowFirstRunChecklist()
}

function completeFirstRunChecklist() {
  if (import.meta.client) localStorage.setItem('couple-space-first-run-complete', '1')
  firstRunChecklistVisible.value = false
}

function openFirstPhotoUpload() {
  firstRunChecklistVisible.value = false
  activeNav.value = '时光'
  nextTick(() => timelineRef.value?.openCreate())
}

function openInviteSettings() {
  firstRunChecklistVisible.value = false
  accountVisible.value = true
}

async function reconnectSpaceServices() {
  await Promise.allSettled([
    connectPresence(),
    subscribeMessages(),
    subscribeAlbumPhotos(),
    ensureCallChannel(),
    ensureLiveChannel(),
  ])
}

async function loadCoupleCover() {
  const { $supabase } = useNuxtApp()
  if (!$supabase || !profile.value?.coupleId) {
    selectedCoverUrl.value = localStorage.getItem('couple-space-cover-url') || ''
    return
  }
  const { data } = await $supabase.from('couples').select('cover_path').eq('id', profile.value.coupleId).maybeSingle()
  selectedCoverPath.value = data?.cover_path || ''
  if (!selectedCoverPath.value) { selectedCoverUrl.value = ''; return }
  const matched = allPhotos.value.find(photo => photo.path === selectedCoverPath.value)
  const coverPath = matched?.mediaType === 'video' ? (matched.videoPosterPath || matched.path) : selectedCoverPath.value
  const coverBucket = (matched?.source === 'memory' || (!matched && !selectedCoverPath.value.includes('/album-media/') && !selectedCoverPath.value.startsWith('album-media/'))) ? 'memory-photos' : 'album-media'
  selectedCoverUrl.value = await createMediaSignedUrl($supabase, coverPath, coverBucket, { width: 1400, height: 900, resize: 'cover', quality: 84 })
}

async function chooseCover(photo: { path: string; url: string; source?: 'album' | 'memory'; mediaType?: 'image' | 'video'; videoPosterPath?: string }) {
  const { $supabase } = useNuxtApp()
  selectedCoverPath.value = photo.path
  const coverPath = photo.mediaType === 'video' ? (photo.videoPosterPath || photo.path) : photo.path
  selectedCoverUrl.value = $supabase
    ? await createMediaSignedUrl($supabase, coverPath, photo.source === 'memory' ? 'memory-photos' : 'album-media', { width: 1400, height: 900, resize: 'cover', quality: 84 })
    : photo.url
  if ($supabase && profile.value?.coupleId && photo.path) {
    const { error } = await $supabase.from('couples').update({ cover_path: photo.path }).eq('id', profile.value.coupleId)
    if (error) throw error
  } else localStorage.setItem('couple-space-cover-url', photo.url)
  coverPickerVisible.value = false
}

onMounted(async () => {
  syncOnlineState()
  window.addEventListener('online', syncOnlineState)
  window.addEventListener('offline', syncOnlineState)
  if (localStorage.getItem('couple-space-first-run-intro') !== '1') firstRunIntroVisible.value = true
  // Auth/session restoration should never leave a blank shell indefinitely on
  // a slow network. The auth listener can still finish in the background.
  await settleWithin(initialize(), 7000)
  authVisible.value = stage.value !== 'paired'
  if (stage.value === 'paired') {
    maybeShowFirstRunChecklist()
    startPairedBootstrap()
  }
  appReady.value = true
})

watch(stage, async value => {
  authVisible.value = value !== 'paired'
  if (value === 'paired') {
    maybeShowFirstRunChecklist()
    startPairedBootstrap()
  } else {
    pairedBootstrapStarted = false
    await disconnectCall()
    await disconnectLive()
    await disconnectPresence()
    await disconnectMessages()
    await disconnectMembers()
    await disconnectAlbumPhotos()
  }
})
watch(callStatus, value => { if (value === 'ringing') chatVisible.value = true })
watch(() => messages.value.length, (length, previousLength) => {
  if (!appReady.value || length <= previousLength || chatVisible.value || activeNav.value === '悄悄话') return
  const message = messages.value[length - 1]
  if (!message || message.senderId === profile.value?.id) return
  const sender = partnerMember.value?.displayName || 'TA'
  const content = message.content || (message.mediaType === 'image' ? '发来了一张照片' : message.mediaType === 'video' ? '发来了一段视频' : message.mediaType === 'audio' ? '发来了一条语音' : '发来了一条消息')
  messageToast.value = { sender, content }
  void notifySystem(`${sender} 发来悄悄话`, content, 2002)
  if (messageToastTimer) clearTimeout(messageToastTimer)
  messageToastTimer = setTimeout(() => { messageToast.value = null }, 5000)
})
const latestSharedMedia = computed(() => allPhotos.value.filter(photo => photo.url).slice(0, 10))
const firstRunHasMedia = computed(() => latestSharedMedia.value.length > 0)
function revealHomeVideo(event:Event){const video=event.currentTarget as HTMLVideoElement;if(Number.isFinite(video.duration)&&video.duration>0&&video.currentTime===0)video.currentTime=Math.min(.15,video.duration/2)}
function homeVideoReady(event: Event) { revealVideoFrame(event) }
async function refreshHomeMedia(event: Event, path: string, bucket?: string, mediaType: 'image' | 'video' = 'image') { await refreshMediaElement(event, $supabase, path, bucket, mediaType === 'image' ? { width: 640, height: 640, resize: 'contain', quality: 68 } : undefined) }
async function refreshHero(event: Event) { await refreshMediaElement(event, $supabase, homeHeroPath.value, homeHeroPath.value.includes('/album-media/') ? 'album-media' : 'memory-photos', { width: 1400, height: 900, resize: 'cover', quality: 84 }) }
onBeforeUnmount(async () => { window.removeEventListener('online', syncOnlineState); window.removeEventListener('offline', syncOnlineState); await disconnectCall(); await disconnectLive(); await disconnectPresence(); await disconnectMessages(); await disconnectMembers(); await disconnectAlbumPhotos() })

async function openChat() {
  messageToast.value = null
  chatVisible.value = true
  void requestSystemAlerts()
  await markRead()
}

async function leaveSpace() {
  await signOut()
  accountVisible.value = false
  authVisible.value = true
}

async function handleUnlinked() {
  accountVisible.value = false
  await signOut()
  authVisible.value = true
}

function openTimelineComposer() {
  activeNav.value = '时光'
  nextTick(() => timelineRef.value?.openCreate())
}

function selectNav(label: string) {
  pageError.value = ''
  if (label === '悄悄话') chatVisible.value = false
  activeNav.value = label
}

function navigateFromNotification(label: string) {
  notificationVisible.value = false
  activeNav.value = label
  if (label === '悄悄话') chatVisible.value = false
}

function retryPage() {
  pageError.value = ''
  pageRenderKey.value += 1
}

function syncOnlineState() {
  if (import.meta.client) isOffline.value = !navigator.onLine
}
</script>

<template>
  <AppUpdatePrompt />
  <PwaInstallPrompt />
  <UploadQueuePanel />
  <BrandSplash />
  <FirstRunOnboarding v-if="firstRunIntroVisible" phase="intro" @complete="completeFirstRunIntro" />
  <div v-if="!appReady" class="app-loading"><Heart :size="28" fill="currentColor" /><span>正在打开我们的空间</span></div>
  <AuthFlow v-else-if="authVisible" @complete="authVisible = false" />
  <AppShell
    v-else
    :items="navItems"
    :active="activeNav"
    :unread-count="unreadCount"
    :self-member="selfMember"
    :partner-member="partnerMember"
    :partner-online="partnerOnline"
    @select="selectNav"
    @settings="accountVisible = true"
  >
    <template #before>
      <NuxtRouteAnnouncer />
      <LoveSky />
      <div v-if="isOffline" class="offline-banner" role="status"><WifiOff :size="16" /><span>当前处于离线状态，恢复网络后会自动同步</span><button type="button" aria-label="重新检查网络" title="重新检查" @click="syncOnlineState"><RefreshCw :size="15" /></button></div>
      <AnniversaryReminderButton v-if="activeNav === '纪念日'" />
      <FirstRunOnboarding v-if="firstRunChecklistVisible" phase="checklist" :display-name="profile?.displayName" :has-partner="Boolean(partnerMember)" :has-media="firstRunHasMedia" @complete="completeFirstRunChecklist" @upload-photo="openFirstPhotoUpload" @invite-partner="openInviteSettings" />
      <button v-if="messageToast" class="message-toast" type="button" @click="openChat"><MessageCircleHeart :size="20"/><span><strong>{{messageToast.sender}} 发来悄悄话</strong><small>{{messageToast.content}}</small></span><ChevronRight :size="17"/></button>
      <div v-if="liveStatus !== 'idle'" class="live-status-capsule" :class="{broadcasting: liveStatus === 'broadcasting'}">
        <span class="live-status-icon"><Radio :size="17" /></span>
        <span class="live-status-copy"><strong>{{ liveStatus === 'broadcasting' ? '你正在开麦' : `${liveRemoteName} 正在开麦` }}</strong><small>{{ liveStatus === 'broadcasting' ? '对方无需接听即可收听' : (liveRemoteMuted ? '对方暂时静音' : '正在后台收听') }}</small></span>
        <button v-if="liveStatus === 'listening' && liveNeedsGesture" type="button" title="播放开麦声音" @click="resumeLiveAudio"><Volume2 :size="16" /></button>
        <button v-else type="button" :title="liveStatus === 'broadcasting' ? '结束开麦' : '停止收听'" @click="liveStatus === 'broadcasting' ? stopLive() : dismissLive()"><StopCircle v-if="liveStatus === 'broadcasting'" :size="16" /><VolumeX v-else :size="16" /></button>
      </div>
      <p v-if="liveError" class="live-status-error">{{ liveError }}</p>
    </template>

    <main v-if="activeNav === '首页'" class="main-content">
      <header class="topbar">
        <div>
          <p class="eyebrow">{{ todayLabel }}</p>
          <h1>晚上好，{{ coupleNames }}</h1>
        </div>
        <div class="topbar-actions"><button class="message-button glass-panel notification-trigger" type="button" aria-label="打开通知中心" title="通知中心" @click="notificationVisible = true; void refreshAiWorks()"><Bell :size="20"/><strong v-if="notificationUnreadCount" class="notification-badge">{{ notificationUnreadCount > 99 ? '99+' : notificationUnreadCount }}</strong></button><button class="message-button glass-panel" type="button" aria-label="查看空间状态" title="空间状态" @click="spaceStatusVisible=true"><Activity :size="20"/></button><button class="message-button glass-panel" type="button" aria-label="打开设置" title="设置" @click="accountVisible=true"><Settings :size="21"/></button></div>
      </header>

      <section class="hero-section" :class="[{ 'has-cover': displayedHeroPhoto }, `photo-${heroPhotoShape}`]" :style="displayedHeroPhoto ? { '--hero-image': `url('${displayedHeroPhoto}')` } : undefined" aria-labelledby="love-days-title">
        <div class="hero-copy">
          <div class="soft-label"><Heart :size="14" fill="currentColor" /> 我们在一起</div>
          <LoveDuration id="love-days-title" :start="relationshipStart" />
          <p>从 {{ relationshipLabel }} 开始，每一天都有了共同的名字。</p>
          <button class="primary-button" type="button" @click="openTimelineComposer">
            <Plus :size="18" /> 记录此刻
          </button>
        </div>
        <div class="hero-photo" :class="{ empty: !displayedHeroPhoto }" :style="displayedHeroPhoto ? { '--photo-image': `url('${displayedHeroPhoto}')` } : undefined" role="img" :aria-label="displayedHeroPhoto ? '最新的共同照片' : '等待添加共同照片'">
          <img v-if="displayedHeroPhoto" :src="displayedHeroPhoto" alt="情侣空间封面" @error="refreshHero">
          <button class="cover-button glass-panel" type="button" @click="coverPickerVisible = true"><Camera :size="15" /> 选择封面</button>
          <div class="photo-caption glass-panel">
            <MapPin v-if="homeHeroLocation" :size="15" /> {{ homeHeroLocation || '第一张共同照片，等你们来记录' }}
          </div>
        </div>
      </section>

      <LoveQuoteCarousel />
      <PetStreakWidget />

      <section class="dashboard-grid">
        <LoveLetterCard />
        <article class="anniversary-panel panel">
          <div class="section-heading">
            <div>
              <p class="eyebrow">下一次见面的期待</p>
              <h3>下一个特别的日子</h3>
            </div>
            <button class="icon-button" type="button" aria-label="查看所有纪念日" title="查看全部" @click="activeNav = '纪念日'">
              <ChevronRight :size="20" />
            </button>
          </div>
          <div class="date-display">
            <div class="calendar-page">
              <span>{{ nextOccurrence ? String(nextOccurrence.getMonth() + 1).padStart(2, '0') + '月' : '--' }}</span>
              <strong>{{ nextOccurrence ? String(nextOccurrence.getDate()).padStart(2, '0') : '--' }}</strong>
            </div>
            <div>
              <h4>{{ nextAnniversary?.title || '添加第一个纪念日' }}</h4>
              <p>{{ nextAnniversary ? `还有 ${daysUntil(nextAnniversary)} 天` : '让重要日子不再错过' }}</p>
            </div>
          </div>
          <div class="progress-track"><span /></div>
        </article>

        <article class="plans-panel panel">
          <div class="section-heading">
            <div>
              <p class="eyebrow">一起完成的小事</p>
              <h3>今天一起完成</h3>
            </div>
            <span class="plan-count">{{ completedPlanCount }}/{{ togetherItems.length }}</span>
          </div>
          <div class="plan-list">
            <button
              v-for="plan in homePlans"
              :key="plan.id"
              class="plan-item"
              :class="{ done: plan.completed }"
              type="button"
              @click="toggleItem(plan)"
            >
              <span class="check-box"><Check v-if="plan.completed" :size="14" /></span>
              <span><strong>{{ plan.title }}</strong><small>{{ plan.plannedDate || (plan.note || '共同计划') }}</small></span>
            </button>
            <button v-if="!homePlans.length" class="empty-plan" type="button" @click="activeNav = '清单'"><Plus :size="16" /> 添加第一项共同计划</button>
          </div>
        </article>

        <article class="memory-panel panel">
          <div class="section-heading">
            <div>
              <p class="eyebrow">刚刚留下的回忆</p>
              <h3>最近的共同回忆</h3>
            </div>
            <button class="text-button" type="button" @click="activeNav = '时光'">查看时光</button>
          </div>
          <div v-if="latestSharedMedia.length" class="recent-media-grid"><button v-for="(media, mediaIndex) in latestSharedMedia" :key="media.id" type="button" @click="activeNav='相册'"><video v-if="media.mediaType==='video'" :src="media.url" muted playsinline preload="metadata" @loadedmetadata="homeVideoReady" @error="refreshHomeMedia($event, media.path, media.source === 'memory' ? 'memory-photos' : 'album-media')"/><img v-else :src="media.url" alt="最近共同回忆" :loading="mediaIndex < 4 ? 'eager' : 'lazy'" :fetchpriority="mediaIndex < 2 ? 'high' : 'low'" decoding="async" @error="refreshHomeMedia($event, media.path, media.source === 'memory' ? 'memory-photos' : 'album-media')"><span>{{media.takenDate}} · {{media.uploaderName}}</span></button></div>
          <button v-else class="empty-memory" type="button" @click="activeNav = '相册'"><Plus :size="19" /><span><strong>还没有共同照片</strong><small>从相册或时光上传第一张照片</small></span></button>
        </article>
      </section>
    </main>
    <main v-else-if="activeNav === '时光'" class="main-content"><NuxtErrorBoundary :key="pageRenderKey" @error="pageError = $event.message"><Suspense><LazyTimelineView ref="timelineRef" @back="selectNav('首页')" /><template #fallback><Loading variant="skeleton" label="正在加载页面" /></template></Suspense><template #error><EmptyState class="page-error" title="时光轴暂时无法打开" :description="pageError"><template #actions><button type="button" @click="retryPage">重新加载</button></template></EmptyState></template></NuxtErrorBoundary></main>
    <main v-else-if="activeNav === '相册'" class="main-content"><NuxtErrorBoundary :key="pageRenderKey" @error="pageError = $event.message"><Suspense><LazyAlbumView @back="selectNav('首页')" /><template #fallback><Loading variant="skeleton" label="正在加载页面" /></template></Suspense><template #error><EmptyState class="page-error" title="相册暂时无法打开" :description="pageError"><template #actions><button type="button" @click="retryPage">重新加载</button></template></EmptyState></template></NuxtErrorBoundary></main>
    <main v-else-if="activeNav === '清单'" class="main-content"><NuxtErrorBoundary :key="pageRenderKey" @error="pageError = $event.message"><Suspense><LazyTogetherListView @back="selectNav('首页')" /><template #fallback><Loading variant="skeleton" label="正在加载页面" /></template></Suspense><template #error><EmptyState class="page-error" title="清单暂时无法打开" :description="pageError"><template #actions><button type="button" @click="retryPage">重新加载</button></template></EmptyState></template></NuxtErrorBoundary></main>
    <main v-else-if="activeNav === '纪念日'" class="main-content"><NuxtErrorBoundary :key="pageRenderKey" @error="pageError = $event.message"><Suspense><LazyAnniversaryView @back="selectNav('首页')" /><template #fallback><Loading variant="skeleton" label="正在加载页面" /></template></Suspense><template #error><EmptyState class="page-error" title="纪念日暂时无法打开" :description="pageError"><template #actions><button type="button" @click="retryPage">重新加载</button></template></EmptyState></template></NuxtErrorBoundary></main>
    <main v-else-if="activeNav === '悄悄话'" class="main-content chat-main"><NuxtErrorBoundary :key="pageRenderKey" @error="pageError = $event.message"><Suspense><LazyChatPanel mode="page" @close="selectNav('首页')" /><template #fallback><Loading variant="skeleton" label="正在加载页面" /></template></Suspense><template #error><EmptyState class="page-error" title="悄悄话暂时无法打开" :description="pageError"><template #actions><button type="button" @click="retryPage">重新加载</button></template></EmptyState></template></NuxtErrorBoundary></main>
     <main v-else-if="activeNav === '心动AI'" class="main-content"><NuxtErrorBoundary :key="pageRenderKey" @error="pageError = $event.message"><Suspense><LazyHeartAiView @back="selectNav('首页')" /><template #fallback><Loading variant="skeleton" label="正在加载页面" /></template></Suspense><template #error><EmptyState class="page-error" title="心动 AI 暂时无法打开" :description="pageError"><template #actions><button type="button" @click="retryPage">重新加载</button></template></EmptyState></template></NuxtErrorBoundary></main>
     <main v-else-if="activeNav === '宠物小屋'" class="main-content"><NuxtErrorBoundary :key="pageRenderKey" @error="pageError = $event.message"><Suspense><LazyPetHouseView @back="selectNav('首页')" /><template #fallback><Loading variant="skeleton" label="正在加载页面" /></template></Suspense><template #error><EmptyState class="page-error" title="宠物小屋暂时无法打开" :description="pageError"><template #actions><button type="button" @click="retryPage">重新加载</button></template></EmptyState></template></NuxtErrorBoundary></main>
    <main v-else class="main-content" />

    <template #overlays>

      <LazyAccountPanel v-if="accountVisible" @close="accountVisible = false" @logout="leaveSpace" @unlinked="handleUnlinked" @relationship-updated="loadHomeData" />
      <LazyChatPanel v-if="chatVisible" mode="drawer" @close="chatVisible = false" />
      <CallScreen v-if="callStatus !== 'idle'" :partner="partnerMember" @minimized="chatVisible = false" />
      <LazySpaceStatusPanel v-if="spaceStatusVisible" @close="spaceStatusVisible = false" @reconnect="reconnectSpaceServices" />
      <NotificationCenterPanel v-if="notificationVisible" :notifications="notifications" :unread-count="notificationUnreadCount" :loading="notificationAiLoading" @close="notificationVisible = false" @read="markNotificationRead" @read-all="markAllNotificationsRead" @navigate="navigateFromNotification" @refresh="refreshAiWorks" />
      <div v-if="coverPickerVisible" class="cover-picker-overlay" @click.self="coverPickerVisible = false">
        <section class="cover-picker">
          <header><div><p class="eyebrow">首页封面</p><h2>选择首页封面</h2></div><button type="button" aria-label="关闭" @click="coverPickerVisible = false"><X :size="20" /></button></header>
          <p>从你们已经上传的照片中选择一张，双方会看到相同封面。</p>
          <div v-if="allPhotos.length" class="cover-photo-grid"><button v-for="photo in allPhotos" :key="photo.id" type="button" :class="{ selected: photo.path === selectedCoverPath }" @click="chooseCover(photo)"><img :src="photo.url" alt="可选封面"><span>{{ photo.albumName }}</span></button></div>
          <div v-else class="cover-empty">相册中还没有照片，请先上传一张。</div>
        </section>
      </div>
    </template>
  </AppShell>
</template>
