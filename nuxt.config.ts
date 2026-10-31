// https://nuxt.com/docs/api/configuration/nuxt-config
import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  // 登录、配对和首页使用 Nuxt 文件路由；会话由客户端统一初始化。
  pages: true,
  css: ['~/assets/css/index.css'],
  app: {
    head: {
      viewport: 'width=device-width, initial-scale=1, viewport-fit=cover',
      title: 'Love小家 · CoupleSpace',
      meta: [
        { name: 'theme-color', content: '#f7edf9' },
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
        { name: 'apple-mobile-web-app-title', content: 'Love小家' },
      ],
      link: [
        { rel: 'manifest', href: '/manifest.webmanifest' },
        { rel: 'icon', href: '/favicon.ico' },
        { rel: 'apple-touch-icon', href: '/desktop-icon.png' },
      ],
    },
  },
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      include: ['@capacitor/core', '@capacitor/geolocation'],
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/zego-express-engine-webrtc')) return 'vendor-zego-engine'
            if (id.includes('node_modules/three')) return 'vendor-three'
            if (id.includes('node_modules/leaflet')) return 'vendor-map'
            if (id.includes('node_modules/@capacitor')) return 'vendor-capacitor'
            return undefined
          },
        },
      },
    },
  },
  runtimeConfig: {
    // 私有配置：仅 Nitro 服务端读取，不能放进 public。
    // 生产使用 NUXT_DEEPSEEK_API_KEY 运行时注入；DEEPSEEK_API_KEY 由服务端请求时读取。
    // 不把真实密钥作为构建默认值写进产物。
    deepseekApiKey: '',
    // deepseek-chat 已被官方停用；可通过私有环境变量调整模型。
    deepseekModel: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
    public: {
      supabaseUrl: process.env.NUXT_PUBLIC_SUPABASE_URL || '',
      supabaseAnonKey: process.env.NUXT_PUBLIC_SUPABASE_ANON_KEY || '',
      turnUrl: process.env.NUXT_PUBLIC_TURN_URL || '',
      turnUrls: process.env.NUXT_PUBLIC_TURN_URLS || process.env.NUXT_PUBLIC_TURN_URL || '',
      turnUsername: process.env.NUXT_PUBLIC_TURN_USERNAME || '',
      turnCredential: process.env.NUXT_PUBLIC_TURN_CREDENTIAL || '',
      zegoAppId: process.env.NUXT_PUBLIC_ZEGO_APP_ID || '',
      zegoServer: process.env.NUXT_PUBLIC_ZEGO_SERVER || 'wss://webliveroom-api.zego.im/ws',
      amapKey: process.env.NUXT_PUBLIC_AMAP_KEY || '',
      amapSecurityCode: process.env.NUXT_PUBLIC_AMAP_SECURITY_CODE || '',
      appVersion: process.env.NUXT_PUBLIC_APP_VERSION || '1.0.0',
      updateManifestUrl: process.env.NUXT_PUBLIC_UPDATE_MANIFEST_URL || 'https://love-home.pages.dev/app-update.json',
    },
  },
  routeRules: {
    '/**': { headers: { 'cache-control': 'no-store, max-age=0' } },
  },
})
