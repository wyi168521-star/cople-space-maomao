import { describe, expect, it } from 'vitest'
import { parseDailyDiaryInput, parseLoveQuoteInput } from '../shared/utils/aiInput'
import { LOCAL_LOVE_QUOTES, localDiary, localLoveQuote } from '../shared/utils/aiFallback'
import { createAiRateLimiter } from '../server/utils/aiRateLimit'

describe('AI input and local content', () => {
  it('accepts only intended quote fields and validates days without coercion', () => {
    expect(parseLoveQuoteInput({ coupleName: ' 小林 & 小许 ', daysTogether: 0, apiKey: 'ignored' }))
      .toEqual({ coupleName: '小林 & 小许', daysTogether: 0 })
    for (const daysTogether of [-1, 1.5, '20', NaN, Infinity, 1000001]) {
      expect(() => parseLoveQuoteInput({ coupleName: '我们', daysTogether })).toThrow()
    }
    expect(() => parseLoveQuoteInput({ coupleName: ' ', daysTogether: 2 })).toThrow()
  })
  it('strips memory metadata and bounds both individual and combined content', () => {
    expect(parseDailyDiaryInput({ memories: [{ title: ' 散步 ', body: null, storage_path: 'ignored', location: '公园' }] }))
      .toEqual({ memories: [{ title: '散步', body: '', location: '公园' }] })
    expect(() => parseDailyDiaryInput({ memories: Array(21).fill({ title: '一天' }) })).toThrow()
    expect(() => parseDailyDiaryInput({ memories: [{ title: '一天', body: '字'.repeat(1501) }] })).toThrow()
    expect(() => parseDailyDiaryInput({ memories: Array(10).fill({ title: '一天', body: '字'.repeat(1500) }) })).toThrow()
    expect(() => parseDailyDiaryInput({ memories: [null] })).toThrow()
  })
  it('provides stable daily quotes under 20 Unicode characters and honest local diary text', () => {
    expect(localLoveQuote('2026-10-31:couple')).toBe(localLoveQuote('2026-10-31:couple'))
    expect(LOCAL_LOVE_QUOTES.every(quote => [...quote].length <= 20)).toBe(true)
    expect(localDiary([{ title: '海边', body: '一起看日落' }])).toContain('海边：一起看日落')
    expect(localDiary([])).toContain('还没有写下具体的回忆')
  })
})

describe('AI generation quota', () => {
  it('limits per authenticated identity and expires the window', () => {
    const allow = createAiRateLimiter(2, 1000)
    expect(allow('a', 0)).toBe(true)
    expect(allow('a', 1)).toBe(true)
    expect(allow('a', 2)).toBe(false)
    expect(allow('b', 2)).toBe(true)
    expect(allow('a', 1000)).toBe(true)
  })
})
