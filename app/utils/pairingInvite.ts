/** URL 参数只接受单个 UUID；重复、空值或任意网址都不能成为加入目标。 */
export function normalizeCoupleId(value: unknown): string {
  if (typeof value !== 'string') return ''
  const id = value.trim()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id.toLowerCase() : ''
}

/** 仅在固定站内路径之间传递邀请；无效输入保留一个标记供页面说明。 */
export function inviteAuthPath(path: '/login' | '/pairing', invite?: unknown): string {
  return invite === undefined ? path : `${path}?invite=${normalizeCoupleId(invite) || 'invalid'}`
}

export function buildPairingInvite(origin: string, coupleId: unknown): string {
  const id = normalizeCoupleId(coupleId)
  if (!id) return ''
  try {
    const base = new URL(origin)
    if (base.protocol !== 'https:' && base.protocol !== 'http:') return ''
    const url = new URL('/pairing', base.origin)
    url.searchParams.set('invite', id)
    return url.href
  } catch { return '' }
}
