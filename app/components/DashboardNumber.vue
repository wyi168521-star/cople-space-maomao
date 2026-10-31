<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{ value: number | null }>()
const displayed = ref<number | null>(null)
let frame = 0
let mounted = false
let motion: MediaQueryList | undefined
const compact = new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 })
const formatted = computed(() => displayed.value === null ? '—'
  : displayed.value >= 10000 ? compact.format(displayed.value) : displayed.value.toLocaleString('zh-CN'))

function animate() {
  cancelAnimationFrame(frame)
  const target = props.value
  if (target === null || motion?.matches) { displayed.value = target; return }
  const from = displayed.value ?? 0
  const start = performance.now()
  function tick(now: number) {
    const progress = Math.min(1, (now - start) / 650)
    displayed.value = Math.round(from + (target! - from) * (1 - (1 - progress) ** 3))
    if (progress < 1) frame = requestAnimationFrame(tick)
  }
  frame = requestAnimationFrame(tick)
}
function motionChanged() { if (motion?.matches) { cancelAnimationFrame(frame); displayed.value = props.value } }
watch(() => props.value, () => { if (mounted) animate() })
onMounted(() => {
  mounted = true
  motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  motion.addEventListener('change', motionChanged)
  animate()
})
onBeforeUnmount(() => { mounted = false; cancelAnimationFrame(frame); motion?.removeEventListener('change', motionChanged) })
</script>

<template>
  <span class="love-dashboard__number" :title="value?.toLocaleString('zh-CN')" aria-hidden="true">{{ formatted }}</span>
  <span class="sr-only">{{ value === null ? '暂不可用' : value.toLocaleString('zh-CN') }}</span>
</template>
