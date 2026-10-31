export default defineNuxtRouteMiddleware(async (to) => {
  // Browser sessions live in localStorage; SSR must not guess their auth state.
  if (import.meta.server) return
  const auth = useAuth()
  if (import.meta.dev) console.info('[LoveAuth] guard', { path: to.path, initialized: auth.initialized.value })
  // 公开登录页必须先渲染，即使 SDK 会话恢复正在等待或本地 API 离线。
  if (to.path === '/login') {
    void auth.initialize().catch(() => {})
    return
  }
  await auth.initialize()
  if (auth.user.value && !auth.membershipReady.value && auth.stage.value !== 'membership-error') {
    await auth.refreshMembership().catch(() => {})
  }
  const redirect = auth.authRedirect(to.path, to.query.invite)
  if (redirect) return navigateTo(redirect, { replace: true })
})
