<script setup lang="ts">
import { ArrowLeft, Camera, Heart, Image, Images, LoaderCircle, LockKeyhole, Plus, RefreshCw, X } from '@lucide/vue'
import '../../styles/album-catalog.css'

useHead({ title: '我们的相册 · Love小家' })
const { user, profile } = useAuth()
const { albums, albumsLoading, detailsLoading, creating, errorMessage, detailsError,
  loadAlbums, createAlbum, coverFailed, retryCover } = useAlbums({ catalog: true })
const editor = ref<HTMLDialogElement | null>(null)
const nameInput = ref<HTMLInputElement | null>(null)
const name = ref('')
const formError = ref('')
const notice = ref('')
const pending = ref(false)
const busy = computed(() => creating.value || pending.value)
let formGeneration = 0
const dateFormat = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Shanghai' })
const createdLabel = (value: string) => dateFormat.format(new Date(value))

function openEditor() {
  name.value = ''; formError.value = ''; notice.value = ''
  editor.value?.showModal()
  nameInput.value?.focus()
}
function closeEditor() { if (!busy.value) editor.value?.close() }
async function saveAlbum() {
  if (busy.value) return
  const version = ++formGeneration
  pending.value = true
  formError.value = ''
  try {
    await createAlbum(name.value)
    if (version !== formGeneration) return
    editor.value?.close()
    notice.value = '新相册已创建，给未来的照片留一个位置。'
  } catch (error) {
    if (version === formGeneration) formError.value = error instanceof Error ? error.message : '创建失败，请稍后重试。'
  } finally {
    if (version === formGeneration) pending.value = false
  }
}
watch([() => user.value?.id, () => profile.value?.coupleId], () => {
  formGeneration++; pending.value = false; name.value = ''; formError.value = ''; notice.value = ''; editor.value?.close()
}, { flush: 'sync' })
onBeforeUnmount(() => { formGeneration++; editor.value?.close() })
</script>

<template>
  <main class="album-catalog">
    <div class="album-catalog__layout">
      <nav class="album-catalog__nav" aria-label="小家导航"><NuxtLink to="/"><ArrowLeft :size="17" aria-hidden="true" />回到小家</NuxtLink><div><NuxtLink to="/timeline">时光轴</NuxtLink><NuxtLink to="/whispers">悄悄话</NuxtLink><NuxtLink to="/albums" aria-current="page">相册</NuxtLink></div></nav>
      <header class="album-catalog__header">
        <div><p class="album-catalog__eyebrow"><Heart :size="14" aria-hidden="true" />OUR SHARED ALBUMS</p><h1>我们的相册</h1><p class="album-catalog__intro">把喜欢的日子，一页页收藏。</p></div>
        <div class="album-catalog__actions"><button class="album-catalog__refresh" type="button" aria-label="刷新相册列表" :disabled="albumsLoading || detailsLoading || busy" @click="loadAlbums"><RefreshCw :size="18" :class="{ 'album-catalog__spinner': albumsLoading || detailsLoading }" aria-hidden="true" /></button><button id="new-album-button" class="album-catalog__primary" type="button" :disabled="albumsLoading || busy" @click="openEditor"><Plus :size="18" aria-hidden="true" />新建相册</button></div>
      </header>

      <p v-if="notice" class="album-catalog__notice" role="status">{{ notice }}</p>
      <div v-if="errorMessage" class="album-catalog__error" role="alert"><p>{{ errorMessage }}</p><button type="button" :disabled="albumsLoading" @click="loadAlbums">重新加载</button></div>
      <div v-if="detailsError" class="album-catalog__error" role="alert"><p>{{ detailsError }}</p><button type="button" :disabled="albumsLoading || detailsLoading" @click="loadAlbums">刷新相册信息</button></div>
      <div v-if="albumsLoading" class="album-catalog__state" role="status"><LoaderCircle :size="25" class="album-catalog__spinner" aria-hidden="true" /><p>正在打开我们的相册…</p></div>
      <div v-else-if="!albums.length && !errorMessage" class="love-glass album-catalog__empty"><span><Camera :size="35" aria-hidden="true" /></span><h2>先给回忆一个名字</h2><p>旅行、日常，或每一次见面。<br>为共同的瞬间，留一本相册。</p><button class="album-catalog__primary" type="button" @click="openEditor"><Plus :size="17" aria-hidden="true" />创建第一本相册</button></div>

      <div v-else-if="albums.length && !albumsLoading" class="album-catalog__grid grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <article v-for="album in albums" :key="album.id" class="love-glass album-catalog__card" :data-album-id="album.id" :aria-labelledby="`album-title-${album.id}`">
          <div class="album-catalog__cover" :data-cover-state="album.coverState">
            <NuxtLink class="album-catalog__cover-link" :to="`/albums/${album.id}`" :aria-label="`打开相册：${album.title}`">
              <img v-if="album.coverUrl && album.coverState === 'ready'" :src="album.coverUrl" :alt="`相册「${album.title}」封面`" loading="lazy" decoding="async" @error="coverFailed(album.id)">
              <div v-else class="album-catalog__placeholder"><LoaderCircle v-if="album.coverState === 'loading'" :size="28" class="album-catalog__spinner" aria-hidden="true" /><template v-else><Images :size="39" aria-hidden="true" /><span>{{ album.coverState === 'error' ? '封面暂不可用' : '等一张喜欢的照片' }}</span></template></div>
            </NuxtLink>
            <button v-if="album.coverState === 'error' && album.coverPath" class="album-catalog__cover-retry" type="button" @click="retryCover(album.id)">重新加载封面</button>
            <span class="album-catalog__private"><LockKeyhole :size="12" aria-hidden="true" />我们的私藏</span>
          </div>
          <div class="album-catalog__copy"><h2 :id="`album-title-${album.id}`"><NuxtLink :to="`/albums/${album.id}`">{{ album.title }}</NuxtLink></h2><div class="album-catalog__metadata"><span class="album-catalog__count"><Image :size="15" aria-hidden="true" />{{ album.photoCount === null ? detailsLoading ? '正在数照片…' : '照片数量待刷新' : `${album.photoCount} 张照片` }}</span><time :datetime="album.createdAt">{{ createdLabel(album.createdAt) }}</time></div></div>
        </article>
      </div>
    </div>

    <dialog id="album-editor" ref="editor" class="love-glass album-catalog__dialog" aria-labelledby="album-editor-title" @cancel.prevent="closeEditor">
      <header><div><p class="album-catalog__eyebrow">A PLACE FOR OUR MOMENTS</p><h2 id="album-editor-title">新建相册</h2></div><button class="album-catalog__close" type="button" aria-label="关闭新建相册表单" :disabled="busy" @click="closeEditor"><X :size="21" aria-hidden="true" /></button></header>
      <form :aria-busy="busy" @submit.prevent="saveAlbum"><fieldset :disabled="busy"><label for="album-name"><span>相册名称</span><input id="album-name" ref="nameInput" v-model="name" type="text" required maxlength="40" placeholder="比如：一起看过的海" :aria-describedby="formError ? 'album-form-error' : 'album-name-help'"></label><p id="album-name-help">给这一页故事起个名字，最多 40 个字。</p></fieldset><p v-if="formError" id="album-form-error" class="album-catalog__error" role="alert">{{ formError }}</p><footer><button class="album-catalog__secondary" type="button" :disabled="busy" @click="closeEditor">取消</button><button class="album-catalog__primary" type="submit" :disabled="busy"><LoaderCircle v-if="busy" :size="17" class="album-catalog__spinner" aria-hidden="true" />{{ busy ? '正在创建…' : '创建相册' }}</button></footer></form>
    </dialog>
  </main>
</template>
