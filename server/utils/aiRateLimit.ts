/** 单实例限流；多实例部署时应换成共享存储。 */
export function createAiRateLimiter(limit = 20, windowMs = 10 * 60 * 1000) {
  const entries = new Map<string, { count: number; resetAt: number }>()
  return (key: string, now = Date.now()) => {
    for (const [entryKey, value] of entries) if (value.resetAt <= now) entries.delete(entryKey)
    let entry = entries.get(key)
    if (!entry) {
      // 达到容量后拒绝新窗口，避免无限增长。
      if (entries.size >= 5000) return false
      entry = { count: 0, resetAt: now + windowMs }; entries.set(key, entry)
    }
    if (entry.count >= limit) return false
    entry.count++
    return true
  }
}
