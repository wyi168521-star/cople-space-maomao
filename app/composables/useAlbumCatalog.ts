import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Database } from '../types/database.generated'
import { createPrivateMediaSignedUrls } from './useMediaUrls'

type AlbumRow = Pick<Database['public']['Tables']['albums']['Row'], 'id' | 'title' | 'name' | 'description' | 'cover_path' | 'created_at'>
export type AlbumCard = {
  id: string; title: string; createdAt: string; coverPath: string; coverUrl: string;
  photoCount: number | null; coverState: 'loading' | 'empty' | 'ready' | 'error'
}

/** 新路由使用 albums / album_media / couple-media，不触发旧照片墙的加载或升级。 */
export function useAlbumCatalog() {
  const { $supabase } = useNuxtApp()
  const { user, profile } = useAuth()
  const albums = ref<AlbumCard[]>([])
  const albumsLoading = ref(false)
  const detailsLoading = ref(false)
  const creating = ref(false)
  const errorMessage = ref('')
  const detailsError = ref('')
  let generation = 0
  let readVersion = 0
  let disposed = false
  let request: AbortController | undefined

  const messageOf = (error: unknown) => error && typeof error === 'object' && 'message' in error
    ? String(error.message) : '暂时无法读取相册，请稍后重试。'

  function context() {
    const coupleId = profile.value?.coupleId
    const userId = user.value?.id
    if (!coupleId || !userId) throw new Error('请先登录并加入情侣空间。')
    return { coupleId, userId, generation }
  }
  const current = (state: ReturnType<typeof context>) => !disposed && state.generation === generation
    && state.userId === user.value?.id && state.coupleId === profile.value?.coupleId

  function privatePath(path: string | null | undefined, coupleId: string) {
    const value = path?.replace(/^couple-media\//, '') || ''
    return value.toLowerCase().startsWith(`${coupleId.toLowerCase()}/`) ? value : ''
  }
  function patch(id: string, fields: Partial<AlbumCard>) {
    albums.value = albums.value.map(album => album.id === id ? { ...album, ...fields } : album)
  }

  async function loadAlbums() {
    if (!import.meta.client || disposed) return
    const version = ++readVersion
    request?.abort()
    const controller = new AbortController()
    request = controller
    albumsLoading.value = true
    detailsLoading.value = false
    errorMessage.value = detailsError.value = ''
    try {
      if (!$supabase) throw new Error('数据库连接尚未配置。')
      const state = context()
      const active = () => current(state) && version === readVersion
      const rows: AlbumRow[] = []
      for (let offset = 0; ; offset += 100) {
        const { data, error } = await $supabase.from('albums')
          .select('id,title,name,description,cover_path,created_at').eq('couple_id', state.coupleId)
          .order('created_at', { ascending: false }).order('id', { ascending: false })
          .range(offset, offset + 99).abortSignal(controller.signal)
        if (!active()) return
        if (error) throw error
        rows.push(...(data || []))
        if (!data || data.length < 100) break
      }
      albums.value = rows.map(row => ({ id: row.id, title: row.title || row.name, createdAt: row.created_at,
        coverPath: privatePath(row.cover_path, state.coupleId), coverUrl: '', photoCount: null, coverState: 'loading' }))
      albumsLoading.value = false
      detailsLoading.value = rows.length > 0

      let next = 0
      const worker = async () => {
        while (active() && next < rows.length) {
          const row = rows[next++]!
          try {
            // exact 返回全量照片数，limit(1) 只限制用于默认封面的那一行。
            const { data, count, error } = await $supabase.from('album_media')
              .select('storage_path', { count: 'exact' }).eq('album_id', row.id).eq('media_type', 'photo')
              .order('created_at', { ascending: false }).order('id', { ascending: false })
              .limit(1).abortSignal(controller.signal)
            if (!active()) return
            if (error) throw error
            const coverPath = privatePath(row.cover_path, state.coupleId) || privatePath(data?.[0]?.storage_path, state.coupleId)
            patch(row.id, { photoCount: count, coverPath,
              coverState: coverPath ? 'loading' : row.cover_path || (count || 0) > 0 ? 'error' : 'empty' })
            if (count === null) detailsError.value = '部分相册的照片数量暂不可用，请刷新重试。'
          } catch {
            if (!active()) return
            detailsError.value = '部分相册的照片数量暂不可用，请刷新重试。'
            patch(row.id, { photoCount: null, coverState: privatePath(row.cover_path, state.coupleId) ? 'loading' : 'empty' })
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(4, rows.length) }, worker))
      if (!active()) return
      const covers = albums.value.filter(album => album.coverPath).map(album => ({ path: album.coverPath, bucket: 'couple-media' }))
      const signed = await createPrivateMediaSignedUrls($supabase, covers, 3600)
      if (!active()) return
      albums.value = albums.value.map(album => {
        if (!album.coverPath) return album
        const url = signed.get(`couple-media:${album.coverPath}`) || ''
        return { ...album, coverUrl: url, coverState: url ? 'ready' as const : 'error' as const }
      })
    } catch (error) {
      if (!disposed && version === readVersion) errorMessage.value = messageOf(error)
    } finally {
      if (!disposed && version === readVersion) {
        albumsLoading.value = detailsLoading.value = false
        request = undefined
      }
    }
  }

  async function createAlbum(name: string) {
    if (creating.value) throw new Error('正在创建相册，请稍候。')
    if (!$supabase) throw new Error('数据库连接尚未配置。')
    const state = context()
    const title = name.trim()
    if (!title) throw new Error('请给相册起一个名字。')
    if ([...title].length > 40) throw new Error('相册名称最多 40 个字。')
    creating.value = true
    try {
      const { data, error } = await $supabase.from('albums')
        .insert({ couple_id: state.coupleId, created_by: state.userId, title, name: title })
        .select('id,title,created_at').single()
      if (error) throw new Error(messageOf(error))
      if (current(state)) albums.value = [{ id: data.id, title: data.title, createdAt: data.created_at,
        coverPath: '', coverUrl: '', photoCount: 0, coverState: 'empty' }, ...albums.value.filter(album => album.id !== data.id)]
      return data.id
    } finally {
      if (current(state)) creating.value = false
    }
  }

  function coverFailed(id: string) { patch(id, { coverUrl: '', coverState: 'error' }) }
  async function retryCover(id: string) {
    const album = albums.value.find(item => item.id === id)
    if (!$supabase || !album?.coverPath || album.coverState === 'loading') return
    const state = context()
    const version = readVersion
    patch(id, { coverUrl: '', coverState: 'loading' })
    const result = await createPrivateMediaSignedUrls($supabase, [{ path: album.coverPath, bucket: 'couple-media' }], 3600)
    if (!current(state) || version !== readVersion) return
    const coverUrl = result.get(`couple-media:${album.coverPath}`) || ''
    patch(id, { coverUrl, coverState: coverUrl ? 'ready' : 'error' })
  }

  watch([() => user.value?.id, () => profile.value?.coupleId], () => {
    generation++; readVersion++; request?.abort()
    albums.value = []; creating.value = albumsLoading.value = detailsLoading.value = false
    errorMessage.value = detailsError.value = ''
    if (profile.value?.coupleId && user.value) void loadAlbums()
  }, { flush: 'sync' })
  onMounted(() => { void loadAlbums() })
  onBeforeUnmount(() => { disposed = true; generation++; readVersion++; request?.abort() })

  return { albums, albumsLoading, detailsLoading, creating, errorMessage, detailsError, loadAlbums, createAlbum, coverFailed, retryCover }
}
