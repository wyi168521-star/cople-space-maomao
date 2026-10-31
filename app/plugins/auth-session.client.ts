export default defineNuxtPlugin({
  name: 'auth-session',
  dependsOn: ['supabase'],
  setup(nuxtApp) {
    const auth = useCoupleAuth()
    const router = useRouter()
    let mounted = false

    function syncRoute() {
      if (!mounted || !auth.initialized.value || auth.membershipLoading.value) return
      const redirect = auth.authRedirect(router.currentRoute.value.path, router.currentRoute.value.query.invite)
      if (redirect) void router.replace(redirect).catch(() => {})
    }

    const stopWatch = watch([auth.user, auth.stage, auth.membershipLoading, auth.initialized], syncRoute, { flush: 'post' })
    nuxtApp.hook('app:mounted', () => { mounted = true; syncRoute() })
    // 不能让会话请求阻塞 Nuxt 挂载；登录页负责显示初始化进度和错误。
    if (import.meta.dev) console.info('[LoveAuth] plugin ready; restoring session in background')
    void auth.initialize().catch(() => { /* Reactive auth state renders the error. */ })

    if (import.meta.hot) {
      import.meta.hot.dispose(() => { stopWatch(); auth.disposeSession() })
    }
  },
})
