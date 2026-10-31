import { describe, expect, it } from 'vitest'
import { beijingDate, calendarDaysUntil, isCalendarDate, nextAnniversaryDate, untilNextBeijingDay } from '../app/utils/anniversaryDates'

describe('anniversary calendar dates', () => {
  it('validates actual calendar dates instead of normalizing invalid days', () => {
    expect(isCalendarDate('2024-02-29')).toBe(true)
    expect(isCalendarDate('2023-02-29')).toBe(false)
    expect(isCalendarDate('2026-04-31')).toBe(false)
    expect(isCalendarDate('0000-01-01')).toBe(false)
    expect(isCalendarDate('2026/10/30')).toBe(false)
  })
  it('excludes expired one-off dates, while retaining today and future dates', () => {
    expect(nextAnniversaryDate('2026-10-29', false, '2026-10-30')).toBeNull()
    expect(nextAnniversaryDate('2026-10-30', false, '2026-10-30')).toBe('2026-10-30')
    expect(calendarDaysUntil('2026-11-02', '2026-10-30')).toBe(3)
  })
  it('rolls passed annual dates into the next year and keeps a same-day date at zero', () => {
    expect(nextAnniversaryDate('2023-05-20', true, '2026-10-30')).toBe('2027-05-20')
    expect(nextAnniversaryDate('2023-10-30', true, '2026-10-30')).toBe('2026-10-30')
    expect(calendarDaysUntil('2026-10-30', '2026-10-30')).toBe(0)
  })
  it('never schedules a recurring event before its original future date', () => {
    expect(nextAnniversaryDate('2028-02-29', true, '2026-01-01')).toBe('2028-02-29')
  })
  it('uses February 28 in non-leap years and February 29 in leap years', () => {
    expect(nextAnniversaryDate('2024-02-29', true, '2025-02-01')).toBe('2025-02-28')
    expect(nextAnniversaryDate('2024-02-29', true, '2025-03-01')).toBe('2026-02-28')
    expect(nextAnniversaryDate('2024-02-29', true, '2028-02-01')).toBe('2028-02-29')
  })
  it('handles calendar year boundaries without timezone or DST division drift', () => {
    expect(calendarDaysUntil('2027-01-01', '2026-12-31')).toBe(1)
    expect(calendarDaysUntil('2026-03-09', '2026-03-07')).toBe(2)
    expect(nextAnniversaryDate('2023-01-01', true, '2026-12-31')).toBe('2027-01-01')
  })
  it('finds Beijing today independently of the browser timezone', () => {
    expect(beijingDate(new Date('2026-10-30T15:59:59Z'))).toBe('2026-10-30')
    expect(beijingDate(new Date('2026-10-30T16:00:00Z'))).toBe('2026-10-31')
  })
  it('schedules a day update at Beijing midnight instead of polling each second', () => {
    expect(untilNextBeijingDay(new Date('2026-10-30T15:59:59Z'))).toBe(1050)
    expect(untilNextBeijingDay(new Date('2026-10-30T16:00:00Z'))).toBe(86400050)
  })
})
