<script setup lang="ts">
// 独立的小脚本在 Nuxt 模块加载失败时也能把 SSR 加载占位改为可重试提示。
useHead({ script: [{ src: '/love-boot.js', defer: true, tagPosition: 'bodyClose' }] })
onMounted(() => window.dispatchEvent(new Event('love:mounted')))
</script>

<template>
  <ClientOnly>
    <NuxtPage />
    <template #fallback>
      <main id="love-boot-fallback" class="session-loading" role="status">
        <div>
          <p id="love-boot-message">正在打开我们的小家…</p>
          <p id="love-boot-detail" hidden></p>
          <button id="love-boot-retry" type="button" hidden>重新载入页面</button>
          <noscript>请启用浏览器的 JavaScript 后重新打开页面。</noscript>
        </div>
      </main>
    </template>
  </ClientOnly>
</template>

<style>
.session-loading { min-height: 100svh; display: grid; place-items: center; padding: 24px; color: var(--muted, #8a817c); }
.session-loading > div { width: min(460px, 100%); text-align: center; }
.session-loading p { margin: 0 0 16px; line-height: 1.7; }
.session-loading button { min-height: 44px; padding: 10px 20px; border: 1px solid rgba(138,129,124,.2); border-radius: 12px; background: var(--color-glass, #f7f5f2); color: inherit; cursor: pointer; }
</style>
