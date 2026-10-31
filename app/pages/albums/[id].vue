<script setup lang="ts">
import { ArrowLeft, ImageOff, Images, LoaderCircle, RefreshCw, Upload, X } from '@lucide/vue'
import { useAlbumDetails } from '../../composables/useAlbumDetails'
import '../../styles/album-catalog.css'
import '../../styles/album-detail.css'

const route = useRoute()
const { user, profile } = useAuth()
const { album, photos, loading, signing, uploading, errorMessage, uploadError, notice,
  uploadStatus, uploadedCount, uploadTotal, refresh, uploadPhotos, retryPhoto, photoFailed } =
  useAlbumDetails(() => String(route.params.id || ''))
useHead({ title: computed(() => `${album.value?.title || '我们的相册'} · Love小家`) })

const fileInput = ref<HTMLInputElement | null>(null)
const preview = ref<HTMLDialogElement | null>(null)
const selectedId = ref('')
const previewLoading = ref(false)
const selectedPhoto = computed(() => photos.value.find(photo => photo.id === selectedId.value))
const canUpload = computed(() => !!album.value && !loading.value && !uploading.value && !errorMessage.value)

async function choosePhotos(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = '' // 失败后也可以再次选择相同文件。
  await uploadPhotos(files)
}
function openPreview(id: string) {
  const photo = photos.value.find(item => item.id === id)
  if (!photo?.url || photo.state !== 'ready') return
  selectedId.value = id
  previewLoading.value = true
  preview.value?.showModal()
}
function closePreview() {
  preview.value?.close()
  selectedId.value = ''
  previewLoading.value = false
}
function previewFailed() {
  if (selectedId.value) photoFailed(selectedId.value)
  previewLoading.value = false
}
watch(() => selectedPhoto.value?.url, () => {
  if (selectedPhoto.value?.url) previewLoading.value = true
})
watch([() => user.value?.id, () => profile.value?.coupleId, () => route.params.id], closePreview, { flush: 'sync' })
onBeforeUnmount(closePreview)
</script>

<template>
  <main class="album-catalog album-detail">
    <div class="album-catalog__layout">
      <nav class="album-catalog__nav" aria-label="相册导航">
        <NuxtLink to="/albums"><ArrowLeft :size="18" aria-hidden="true" />返回相册</NuxtLink>
        <NuxtLink to="/">回到小家</NuxtLink>
      </nav>
      <header class="album-catalog__header">
        <div>
          <p class="album-catalog__eyebrow"><Images :size="14" aria-hidden="true" />OUR LITTLE MOMENTS</p>
          <h1>{{ album?.title || (loading ? '正在打开相册…' : '我们的相册') }}</h1>
          <p class="album-catalog__intro">{{ album ? `${photos.length} 张照片，收藏我们的每一个瞬间。` : '只有你们可以看见的照片墙。' }}</p>
        </div>
        <div class="album-catalog__actions">
          <button class="album-catalog__refresh" type="button" aria-label="刷新照片墙"
            :disabled="loading || signing || uploading" @click="refresh">
            <RefreshCw :size="18" :class="{ 'album-catalog__spinner': loading || signing }" aria-hidden="true" />
          </button>
          <button id="upload-album-photos" class="album-catalog__primary" type="button" :disabled="!canUpload" @click="fileInput?.click()">
            <LoaderCircle v-if="uploading" :size="18" class="album-catalog__spinner" aria-hidden="true" />
            <Upload v-else :size="18" aria-hidden="true" />{{ uploading ? '正在上传…' : '上传照片' }}
          </button>
          <input ref="fileInput" class="hidden" type="file" multiple accept="image/*" :disabled="!canUpload" aria-label="选择要上传的照片" @change="choosePhotos">
        </div>
      </header>

      <div v-if="uploading" class="love-glass album-detail__progress" role="status">
        <p>{{ uploadStatus }}</p>
        <progress :value="uploadedCount" :max="uploadTotal || 1" :aria-label="`已上传 ${uploadedCount} / ${uploadTotal} 张照片`" />
      </div>
      <p v-if="notice" class="album-catalog__notice" role="status">{{ notice }}</p>
      <p v-if="uploadError" class="album-catalog__error" role="alert">{{ uploadError }}</p>
      <div v-if="errorMessage" class="album-catalog__error" role="alert">
        <p>{{ errorMessage }}</p><button type="button" :disabled="loading || uploading" @click="refresh">重新加载</button>
      </div>
      <div v-if="loading" class="album-catalog__state" role="status">
        <LoaderCircle :size="26" class="album-catalog__spinner" aria-hidden="true" /><p>正在整理我们的照片…</p>
      </div>
      <div v-else-if="album && !photos.length && !errorMessage" class="love-glass album-catalog__empty">
        <span><Images :size="34" aria-hidden="true" /></span><h2>第一张照片，会是什么呢？</h2>
        <p>一起去过的地方，一起度过的日常。<br>选几张喜欢的照片，放进这本相册。</p>
      </div>
      <div v-else-if="photos.length && !loading" class="album-detail__wall columns-2 gap-4 md:columns-3 lg:columns-4" aria-label="相册照片墙">
        <figure v-for="(photo, index) in photos" :key="photo.id" class="break-inside-avoid mb-4" :data-photo-id="photo.id">
          <button v-if="photo.url && photo.state === 'ready'" class="album-detail__photo" type="button"
            :aria-label="`全屏查看第 ${index + 1} 张照片`" @click="openPreview(photo.id)">
            <img :src="photo.url" :alt="`${album?.title || '相册'} · 第 ${index + 1} 张照片`"
              class="w-full rounded-xl shadow-sm" loading="lazy" decoding="async" @error="photoFailed(photo.id)">
          </button>
          <div v-else class="love-glass album-detail__placeholder">
            <LoaderCircle v-if="photo.state === 'loading'" :size="24" class="album-catalog__spinner" aria-hidden="true" />
            <template v-else><ImageOff :size="26" aria-hidden="true" /><span>这张照片暂时无法打开</span>
              <button type="button" class="album-catalog__secondary" @click="retryPhoto(photo.id)">重试</button></template>
          </div>
        </figure>
      </div>
    </div>

    <dialog id="album-photo-preview" ref="preview" class="album-detail__preview" aria-label="照片全屏预览"
      @cancel.prevent="closePreview" @click.self="closePreview" @close="selectedId = ''">
      <button class="album-detail__preview-close" type="button" aria-label="关闭大图预览" @click="closePreview"><X :size="25" aria-hidden="true" /></button>
      <template v-if="selectedPhoto">
        <LoaderCircle v-if="previewLoading && selectedPhoto.url" :size="34" class="album-catalog__spinner album-detail__preview-spinner" aria-label="正在加载大图" />
        <img v-if="selectedPhoto.url && selectedPhoto.state === 'ready'" :src="selectedPhoto.url" :alt="`${album?.title} · 大图预览`"
          @load="previewLoading = false" @error="previewFailed" @click.stop>
        <div v-else class="album-detail__preview-error" @click.stop><p>图片暂时无法打开，请重新加载。</p>
          <button class="album-catalog__secondary" type="button" @click="retryPhoto(selectedPhoto.id)">重新加载大图</button></div>
      </template>
    </dialog>
  </main>
</template>
