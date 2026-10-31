import { getCurrentScope, onScopeDispose, readonly, ref } from 'vue'

export function useTypewriter(speed = 24) {
  const displayedText = ref(''), fullText = ref(''), typing = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  function stop() { clearTimeout(timer); timer = undefined; typing.value = false }
  function clear() { stop(); displayedText.value = fullText.value = '' }
  function finish() { stop(); displayedText.value = fullText.value }
  function start(text: string) {
    clear()
    fullText.value = text
    if (!text || (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)) {
      finish(); return
    }
    const characters = typeof Intl.Segmenter === 'function'
      ? Array.from(new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }).segment(text), item => item.segment)
      : Array.from(text)
    let index = 0
    typing.value = true
    function tick() {
      displayedText.value += characters[index++] || ''
      if (index < characters.length) timer = setTimeout(tick, Math.max(10, speed))
      else stop()
    }
    tick()
  }
  if (getCurrentScope()) onScopeDispose(clear)
  return { displayedText: readonly(displayedText), fullText: readonly(fullText), typing: readonly(typing), start, clear, finish }
}
