const DAY = 86_400_000
const datePattern = /^\d{4}-\d{2}-\d{2}$/

export function isCalendarDate(value: string) {
  if (!datePattern.test(value) || value.startsWith('0000-')) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function beijingDate(now: Date = new Date()) {
  return new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10)
}

export function calendarDaysUntil(date: string, today: string) {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY)
}

export function nextAnniversaryDate(target: string, repeatYearly: boolean, today: string) {
  if (!isCalendarDate(target) || !isCalendarDate(today)) return null
  if (!repeatYearly) return target >= today ? target : null

  const originalYear = Number(target.slice(0, 4))
  const month = Number(target.slice(5, 7))
  const day = Number(target.slice(8, 10))
  function inYear(year: number) {
    const last = new Date(0)
    last.setUTCFullYear(year, month, 0)
    // 2 月 29 日在非闰年按 2 月 28 日纪念。
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(Math.min(day, last.getUTCDate())).padStart(2, '0')}`
  }
  let year = Math.max(Number(today.slice(0, 4)), originalYear)
  let candidate = inYear(year)
  if (candidate < today) candidate = inYear(++year)
  return isCalendarDate(candidate) ? candidate : null
}

export function untilNextBeijingDay(now: Date = new Date()) {
  const tomorrow = new Date(Date.parse(`${beijingDate(now)}T00:00:00Z`) + DAY).toISOString().slice(0, 10)
  return Math.max(100, Date.parse(`${tomorrow}T00:00:00+08:00`) - now.getTime() + 50)
}
