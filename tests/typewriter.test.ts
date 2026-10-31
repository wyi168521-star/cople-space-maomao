import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, type EffectScope } from 'vue'
import { useTypewriter } from '../app/composables/useTypewriter'

let scope: EffectScope
beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList)
  scope = effectScope()
})
afterEach(() => { scope.stop(); vi.useRealTimers(); vi.restoreAllMocks() })
const setup = () => scope.run(() => useTypewriter(20))!

describe('diary typewriter', () => {
  it('reveals graphemes over time without breaking joined emoji', async () => {
    const writer = setup()
    writer.start('你💜👩‍❤️‍💋‍👩')
    expect(writer.displayedText.value).toBe('你'); expect(writer.typing.value).toBe(true)
    await vi.advanceTimersByTimeAsync(20)
    expect(writer.displayedText.value).toBe('你💜')
    await vi.advanceTimersByTimeAsync(20)
    expect(writer.displayedText.value).toBe('你💜👩‍❤️‍💋‍👩'); expect(writer.typing.value).toBe(false)
  })
  it('finishes immediately on demand and cancels a previous text when starting another', async () => {
    const writer = setup()
    writer.start('第一篇日记'); writer.start('新的日记')
    expect(writer.displayedText.value).toBe('新')
    writer.finish()
    await vi.advanceTimersByTimeAsync(500)
    expect(writer.displayedText.value).toBe('新的日记'); expect(writer.typing.value).toBe(false)
  })
  it('clears all pending ticks when the dialog is closed or its scope is disposed', async () => {
    const writer = setup()
    writer.start('一段回忆'); writer.clear()
    await vi.advanceTimersByTimeAsync(500)
    expect(writer.displayedText.value).toBe(''); expect(writer.fullText.value).toBe('')
    writer.start('另一段回忆'); scope.stop()
    await vi.advanceTimersByTimeAsync(500)
    expect(writer.displayedText.value).toBe('')
    expect(vi.getTimerCount()).toBe(0)
  })
  it('honors reduced motion with immediate full text and no timers', () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList)
    const writer = setup()
    writer.start('想把今天留给我们。')
    expect(writer.displayedText.value).toBe('想把今天留给我们。'); expect(writer.typing.value).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })
})
