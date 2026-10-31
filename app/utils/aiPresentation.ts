import type { DiaryMemory, LoveQuoteInput } from '#shared/types/ai'
import { isCalendarDate } from './anniversaryDates'

export function homepageQuoteInput(nameA: string, nameB: string, startDate: string, now = Date.now()): LoveQuoteInput {
  const start = isCalendarDate(startDate) ? Date.parse(`${startDate}T00:00:00+08:00`) : now
  return { coupleName: [nameA.trim(), nameB.trim()].filter(Boolean).join(' & ') || '我们',
    daysTogether: Math.max(0, Math.floor((now - start) / 86400000)) }
}

/** 与服务端输入限制一致，较长记录公平节选，避免某条长正文挤掉其余回忆。 */
export function diarySelection(rows: DiaryMemory[], today: string) {
  const candidates = rows.filter(row => row.date === today)
  const clip = (value: string | null | undefined, length: number) => [...(value || '').trim()].slice(0, length).join('')
  let excerpted = candidates.length > 20
  const memories = candidates.slice(0, 20).map(row => {
    const title = clip(row.title, 100), location = clip(row.location, 100), body = clip(row.body, 1500)
    if (title !== row.title.trim() || body !== (row.body || '').trim() || location !== (row.location || '').trim()) excerpted = true
    return { title, body, location, date: today }
  })
  const metadataSize = memories.reduce((count, row) => count + [...`${row.title}${row.location}`].length, 0)
  const bodySize = memories.reduce((count, row) => count + [...row.body].length, 0)
  if (metadataSize + bodySize > 12000) {
    excerpted = true
    const perBody = Math.max(0, Math.floor((12000 - metadataSize) / memories.length))
    memories.forEach(row => { row.body = clip(row.body, perBody) })
  }
  return { memories, totalCount: candidates.length, excerpted }
}
