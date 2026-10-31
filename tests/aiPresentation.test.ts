import { describe, expect, it } from 'vitest'
import { homepageQuoteInput, diarySelection } from '../app/utils/aiPresentation'
import { parseDailyDiaryInput } from '../shared/utils/aiInput'

describe('AI presentation input', () => {
  it('counts full days from Beijing midnight, including date boundaries', () => {
    expect(homepageQuoteInput(' 小林 ', '小许', '2023-05-20', Date.parse('2023-05-20T23:59:59+08:00')))
      .toEqual({ coupleName: '小林 & 小许', daysTogether: 0 })
    expect(homepageQuoteInput('小林', '小许', '2023-05-20', Date.parse('2023-05-21T00:00:00+08:00')).daysTogether).toBe(1)
    expect(homepageQuoteInput('', '', '2030-01-01', Date.parse('2026-10-31T00:00:00Z')))
      .toEqual({ coupleName: '我们', daysTogether: 0 })
  })
  it('excludes yesterday and future dates and handles an empty day', () => {
    const rows = [{ title: '昨天', date: '2026-10-30' }, { title: '今天', date: '2026-10-31', body: '一起散步' }, { title: '明天', date: '2026-11-01' }]
    expect(diarySelection(rows, '2026-10-31')).toEqual({ memories: [{ title: '今天', body: '一起散步', location: '', date: '2026-10-31' }], totalCount: 1, excerpted: false })
    expect(diarySelection(rows, '2026-11-02').memories).toEqual([])
  })
  it('keeps excerpts within server limits without dropping all the later memories', () => {
    const selection = diarySelection(Array.from({ length: 25 }, (_, index) => ({ title: `回忆${index}` + '字'.repeat(115), body: '好'.repeat(1500), location: '公园', date: '2026-10-31' })), '2026-10-31')
    expect(selection.totalCount).toBe(25); expect(selection.excerpted).toBe(true)
    expect(selection.memories).toHaveLength(20)
    expect(selection.memories.every(memory => memory.body.length > 0 && [...memory.title].length <= 100)).toBe(true)
    expect(() => parseDailyDiaryInput({ memories: selection.memories })).not.toThrow()
  })
})
