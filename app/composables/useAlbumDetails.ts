import { computed, onBeforeUnmount, onMounted, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { createPrivateMediaSignedUrls, prepareImageForUpload } from './useMediaUrls'

type Photo = { id: string; path: string; url: string; state: 'loading' | 'ready' | 'error'; signedAt: number }
type UploadRow = { id: string; album_id: string; storage_path: string; media_type: 'photo' }
const messageOf = (error: unknown) => error && typeof error === 'object' && 'message' in error
  ? String(error.message || '操作失败，请稍后重试。') : '操作失败，请稍后重试。'

function photoId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // HTTP 局域网地址上 randomUUID 可能不可用。
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 15) | 64; bytes[8] = (bytes[8]! & 63) | 128
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function useAlbumDetails(id: MaybeRefOrGetter<string>) {
  const { $supabase } = useNuxtApp()
  const { user, profile } = useAuth()
  const albumId = computed(() => toValue(id).toLowerCase())
  const album = ref<{ id: string; title: string } | null>(null)
  const photos = ref<Photo[]>([])
  const loading = ref(true), signing = ref(false), uploading = ref(false)
  const errorMessage = ref(''), uploadError = ref(''), notice = ref(''), uploadStatus = ref('')
  const uploadedCount = ref(0), uploadTotal = ref(0)
  let mounted = false, generation = 0, readVersion = 0
  let readRequest: AbortController | undefined
  let renewal: ReturnType<typeof setInterval> | undefined

  function context() {
    const userId = user.value?.id, coupleId = profile.value?.coupleId
    if (!$supabase || !userId || !coupleId) throw new Error('请先登录并加入情侣空间。')
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(albumId.value)) throw new Error('相册编号无效。')
    return { client: $supabase, userId, coupleId, albumId: albumId.value, generation }
  }
  type Context = ReturnType<typeof context>
  const current = (state: Context) => mounted && state.generation === generation
    && state.userId === user.value?.id && state.coupleId === profile.value?.coupleId && state.albumId === albumId.value
  const assertCurrent = (state: Context) => { if (!current(state)) throw new Error('页面或登录状态已改变，上传已停止。') }

  async function hydrate(state: Context, items: Photo[], version: number) {
    signing.value = true
    for (let offset = 0; offset < items.length; offset += 20) {
      if (!current(state) || version !== readVersion) return
      const batch = items.slice(offset, offset + 20)
      const urls = await createPrivateMediaSignedUrls(state.client,
        batch.map(photo => ({ path: photo.path })), 3600, { batch: false })
      if (!current(state) || version !== readVersion) return
      const paths = new Set(batch.map(photo => photo.path))
      photos.value = photos.value.map(photo => {
        if (!paths.has(photo.path)) return photo
        const url = urls.get(`couple-media:${photo.path}`) || ''
        return { ...photo, url, state: url ? 'ready' : 'error', signedAt: url ? Date.now() : 0 }
      })
    }
    if (current(state) && version === readVersion) signing.value = false
  }

  async function refresh() {
    if (!mounted) return
    const version = ++readVersion
    readRequest?.abort()
    const controller = new AbortController()
    readRequest = controller
    loading.value = true; signing.value = false; errorMessage.value = ''
    try {
      const state = context()
      const active = () => current(state) && version === readVersion
      const { data: row, error } = await state.client.from('albums').select('id,title,name')
        .eq('id', state.albumId).eq('couple_id', state.coupleId).abortSignal(controller.signal).maybeSingle()
      if (!active()) return
      if (error) throw error
      if (!row) throw new Error('相册不存在，或不属于你们的空间。')
      album.value = { id: row.id, title: row.title || row.name }
      const rows: Photo[] = []
      for (let offset = 0; ; offset += 200) {
        const result = await state.client.from('album_media').select('id,storage_path')
          .eq('album_id', state.albumId).eq('media_type', 'photo')
          .order('created_at', { ascending: false }).order('id', { ascending: false })
          .range(offset, offset + 199).abortSignal(controller.signal)
        if (!active()) return
        if (result.error) throw result.error
        rows.push(...(result.data || []).map(item => ({ id: item.id, path: item.storage_path,
          url: '', state: 'loading' as const, signedAt: 0 })))
        if (!result.data || result.data.length < 200) break
      }
      photos.value = [...new Map(rows.map(photo => [photo.id, photo])).values()].map(photo =>
        photo.path.startsWith(`${state.coupleId}/`) ? photo : { ...photo, state: 'error' })
      loading.value = false
      await hydrate(state, photos.value.filter(photo => photo.state === 'loading'), version)
    } catch (error) {
      if (mounted && version === readVersion) errorMessage.value = messageOf(error)
    } finally {
      if (mounted && version === readVersion) { loading.value = false; signing.value = false; readRequest = undefined }
    }
  }

  function photoFailed(id: string) {
    photos.value = photos.value.map(photo => photo.id === id ? { ...photo, url: '', state: 'error' } : photo)
  }
  async function retryPhoto(id: string) {
    const photo = photos.value.find(item => item.id === id)
    if (!photo || photo.state === 'loading') return
    const state = context(), version = readVersion
    if (!photo.path.startsWith(`${state.coupleId}/`)) return
    photos.value = photos.value.map(item => item.id === id ? { ...item, state: 'loading' } : item)
    const urls = await createPrivateMediaSignedUrls(state.client, [{ path: photo.path }], 3600, { batch: false })
    if (!current(state) || version !== readVersion) return
    const url = urls.get(`couple-media:${photo.path}`) || ''
    photos.value = photos.value.map(item => item.id === id
      ? { ...item, url, state: url ? 'ready' : 'error', signedAt: url ? Date.now() : 0 } : item)
  }

  async function uploadPhotos(files: File[]) {
    if (uploading.value || !files.length || !album.value || loading.value) return
    let state: Context
    try { state = context() } catch (error) { uploadError.value = messageOf(error); return }
    uploading.value = true; uploadError.value = notice.value = ''
    uploadedCount.value = 0; uploadTotal.value = files.length
    const attempted: string[] = [], rows: UploadRow[] = []
    let commitAttempted = false, commitRejected = false, saved = false, failure = ''
    try {
      for (const [index, file] of files.entries()) {
        assertCurrent(state)
        if (file.type && !file.type.startsWith('image/')) throw new Error(`「${file.name}」不是图片。`)
        uploadStatus.value = `正在处理第 ${index + 1} / ${files.length} 张照片…`
        const compressed = await prepareImageForUpload(file, 1920, 0.8, true)
        assertCurrent(state)
        const id = photoId(), path = `${state.coupleId}/albums/${state.albumId}/${id}.jpg`
        attempted.push(path)
        const { error } = await state.client.storage.from('couple-media').upload(path, compressed, {
          contentType: 'image/jpeg', upsert: false,
        })
        if (error) throw error
        rows.push({ id, album_id: state.albumId, storage_path: path, media_type: 'photo' })
        if (current(state)) uploadedCount.value = index + 1
      }
      assertCurrent(state)
      uploadStatus.value = '正在保存到相册…'
      commitAttempted = true
      const result = await state.client.from('album_media').insert(rows)
      commitRejected = result.status >= 400 && result.status < 500 && result.status !== 408
      if (result.error) throw result.error
      saved = true
    } catch (error) { failure = messageOf(error) }

    // HTTP 回包丢失不代表 INSERT 失败：先核实记录，绝不删除已关联的图片。
    let cleanup = attempted
    if (!saved && commitAttempted && !commitRejected) {
      const confirmed = new Set<string>()
      let verified = true
      try {
        for (let offset = 0; offset < rows.length; offset += 100) {
          const result = await state.client.from('album_media').select('id')
            .eq('album_id', state.albumId).in('id', rows.slice(offset, offset + 100).map(row => row.id))
          if (result.error) throw result.error
          result.data?.forEach(row => confirmed.add(row.id))
        }
      } catch { verified = false }
      saved = verified && confirmed.size === rows.length
      // 查询成功但缺行也不能排除原 INSERT 仍在服务端执行；保留文件避免误删。
      cleanup = []
      if (!saved) failure = '暂时无法确认保存结果。请先刷新相册检查，避免重复上传；已上传的文件已保留。'
    }
    if (!saved && cleanup.length) {
      try {
        for (let offset = 0; offset < cleanup.length; offset += 100) {
          const { error } = await state.client.storage.from('couple-media').remove(cleanup.slice(offset, offset + 100))
          if (error) throw error
        }
      } catch { failure += ' 部分未关联文件未能清理，请稍后检查。' }
    }
    if (!current(state)) return
    if (saved) {
      notice.value = `已收藏 ${rows.length} 张照片。`
      await refresh()
    } else uploadError.value = failure || '上传失败，请重试。'
    if (current(state)) { uploading.value = false; uploadStatus.value = '' }
  }

  function renewIfNeeded() {
    if (document.hidden || loading.value || signing.value || uploading.value) return
    const expired = photos.value.filter(photo => photo.url && Date.now() - photo.signedAt >= 50 * 60 * 1000)
    if (expired.length) void hydrate(context(), expired, readVersion)
  }
  watch([() => user.value?.id, () => profile.value?.coupleId, albumId], () => {
    generation++; readVersion++; readRequest?.abort()
    album.value = null; photos.value = []; uploading.value = signing.value = false
    errorMessage.value = uploadError.value = notice.value = uploadStatus.value = ''
    if (mounted) void refresh()
  }, { flush: 'sync' })
  onMounted(() => {
    mounted = true; void refresh()
    renewal = setInterval(renewIfNeeded, 60000)
    document.addEventListener('visibilitychange', renewIfNeeded)
  })
  onBeforeUnmount(() => {
    mounted = false; generation++; readVersion++; readRequest?.abort()
    clearInterval(renewal); document.removeEventListener('visibilitychange', renewIfNeeded)
  })
  return { album, photos, loading, signing, uploading, errorMessage, uploadError, notice,
    uploadStatus, uploadedCount, uploadTotal, refresh, uploadPhotos, retryPhoto, photoFailed }
}
