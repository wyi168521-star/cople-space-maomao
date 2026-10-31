// 普通静态脚本，不依赖 Nuxt/Vite 模块，因此模块启动失败时仍可提供恢复入口。
(() => {
  if (window.__loveBootWatchdogInstalled) return
  window.__loveBootWatchdogInstalled = true
  const timer = window.setTimeout(() => {
    const fallback = document.getElementById('love-boot-fallback')
    if (!fallback) return
    fallback.setAttribute('role', 'alert')
    document.getElementById('love-boot-message').textContent = '页面未能正常启动'
    const detail = document.getElementById('love-boot-detail')
    detail.hidden = false
    detail.textContent = navigator.onLine
      ? '页面资源加载超时，请重新载入。若仍失败，可在 F12 控制台查看具体错误。'
      : '浏览器当前处于离线状态，请恢复网络后重新载入。'
    const button = document.getElementById('love-boot-retry')
    button.hidden = false
    console.error('[LoveBoot] application did not mount within 20 seconds')
    button.onclick = async () => {
      button.disabled = true
      button.textContent = '正在重新载入…'
      const cleanup = async () => {
        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations()
          await Promise.all(registrations.filter(registration => {
            const worker = registration.active || registration.waiting || registration.installing
            return worker && new URL(worker.scriptURL).origin === location.origin && new URL(worker.scriptURL).pathname === '/sw.js'
          }).map(registration => registration.unregister()))
        }
        if ('caches' in window) {
          const keys = await caches.keys()
          await Promise.all(keys.filter(key => key.startsWith('love-home-shell-')).map(key => caches.delete(key)))
        }
      }
      await Promise.race([cleanup().catch(() => {}), new Promise(resolve => setTimeout(resolve, 2000))])
      location.reload()
    }
  }, 20000)
  window.addEventListener('love:mounted', () => clearTimeout(timer), { once: true })
})()
