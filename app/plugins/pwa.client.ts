export default defineNuxtPlugin(() => {
  if (!('serviceWorker' in navigator)) return
  if (!['http:', 'https:'].includes(window.location.protocol)) return
  if (import.meta.dev) {
    // 开发模块 URL 会重复使用。只清本站的页面壳缓存，不清会话或业务存储。
    void (async () => {
      const ownWorker = (worker: ServiceWorker | null) => worker && new URL(worker.scriptURL).origin === location.origin && new URL(worker.scriptURL).pathname === '/sw.js'
      const controlled = ownWorker(navigator.serviceWorker.controller)
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.filter(registration => ownWorker(registration.active || registration.waiting || registration.installing)).map(registration => registration.unregister()))
      if ('caches' in window) {
        const keys = await caches.keys()
        await Promise.all(keys.filter(key => key.startsWith('love-home-shell-')).map(key => caches.delete(key)))
      }
      const reloadKey = 'love-dev-shell-reloaded'
      if (controlled && !sessionStorage.getItem(reloadKey)) {
        sessionStorage.setItem(reloadKey, '1')
        console.info('[LoveBoot] old development service worker removed; reloading once')
        location.reload()
      } else if (!controlled) sessionStorage.removeItem(reloadKey)
    })().catch(() => { console.warn('[LoveBoot] could not remove old development shell cache') })
    return
  }
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined)
})
