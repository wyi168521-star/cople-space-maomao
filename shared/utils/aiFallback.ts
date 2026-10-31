import type { DiaryMemory } from '../types/ai'

export const LOCAL_LOVE_QUOTES = [
  '有你在，平凡的日子也会发光。',
  '想把每一个明天，都留给我们。',
  '世界很大，我的小家是你。',
  '和你一起，慢慢把日子过成诗。',
  '今天也想认真地喜欢你。',
  '我的每一份期待里，都有你。',
] as const

export function localLoveQuote(seed: string) {
  let hash = 0
  for (const letter of seed) hash = (Math.imul(hash, 31) + letter.codePointAt(0)!) >>> 0
  return LOCAL_LOVE_QUOTES[hash % LOCAL_LOVE_QUOTES.length]!
}
/** 本地只整理传入的记录，不冒充模型生成，也不编造两个人的经历。 */
export function localDiary(memories: DiaryMemory[]) {
  const lines = memories.slice(0, 20).map(memory => {
    const title = [...String(memory.title || '').trim()].slice(0, 100).join('')
    const body = [...String(memory.body || '').trim()].slice(0, 300).join('')
    return [title, body].filter(Boolean).join('：')
  }).filter(Boolean)
  return lines.length
    ? `今天想和你一起留住这些小事：\n\n${lines.join('\n\n')}\n\n一点一滴，都是我们共同生活的痕迹。`
    : '今天还没有写下具体的回忆。先把这份珍惜留在这里，等我们一起慢慢补上。'
}
