import type { DailyDiaryInput, DiaryMemory, LoveQuoteInput } from '../types/ai'

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请求内容必须是一个对象。')
  return value as Record<string, unknown>
}
function text(value: unknown, label: string, max: number, required = false) {
  if (value === undefined || value === null) {
    if (required) throw new Error(`请提供${label}。`)
    return ''
  }
  if (typeof value !== 'string') throw new Error(`${label}必须是文字。`)
  const result = value.trim()
  if (required && !result) throw new Error(`请提供${label}。`)
  if ([...result].length > max) throw new Error(`${label}最多 ${max} 个字。`)
  return result
}
export function parseLoveQuoteInput(value: unknown): LoveQuoteInput {
  const input = object(value)
  const coupleName = text(input.coupleName, '双方昵称', 120, true)
  if (typeof input.daysTogether !== 'number' || !Number.isSafeInteger(input.daysTogether)
    || input.daysTogether < 0 || input.daysTogether > 1000000) throw new Error('在一起天数必须是 0 至 1000000 的整数。')
  return { coupleName, daysTogether: input.daysTogether }
}
export function parseDailyDiaryInput(value: unknown): DailyDiaryInput {
  const input = object(value)
  if (!Array.isArray(input.memories) || input.memories.length > 20) throw new Error('每天最多选择 20 条回忆。')
  const memories: DiaryMemory[] = input.memories.map(value => {
    const memory = object(value)
    const date = text(memory.date, '回忆日期', 10)
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('回忆日期格式应为 YYYY-MM-DD。')
    return { title: text(memory.title, '回忆标题', 100, true), body: text(memory.body, '回忆正文', 1500),
      location: text(memory.location, '地点', 100), ...(date ? { date } : {}) }
  })
  if (memories.reduce((count, memory) => count + [...`${memory.title}${memory.body}${memory.location}`].length, 0) > 12000) {
    throw new Error('回忆内容合计不能超过 12000 个字，请减少选择。')
  }
  return { memories }
}
