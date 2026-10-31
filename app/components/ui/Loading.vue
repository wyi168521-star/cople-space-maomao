<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  variant?: 'spinner' | 'skeleton'
  label?: string
  lines?: number
}>(), {
  variant: 'spinner',
  label: '正在加载，请稍候',
  lines: 4,
})

const skeletonLines = computed(() => Number.isFinite(props.lines)
  ? Math.min(8, Math.max(2, Math.trunc(props.lines)))
  : 4)
</script>

<template>
  <div
    class="ui-loading"
    :class="variant === 'skeleton' ? 'page-skeleton ui-loading--skeleton' : 'ui-loading--spinner'"
    role="status"
    aria-live="polite"
  >
    <span v-if="variant === 'spinner'" class="ui-loading__spinner" aria-hidden="true" />
    <template v-else>
      <span v-for="line in skeletonLines" :key="line" class="ui-loading__bone" aria-hidden="true" />
    </template>
    <span class="ui-loading__label" :class="{ 'ui-loading__label--hidden': variant === 'skeleton' }">{{ label }}</span>
  </div>
</template>

<style scoped>
.ui-loading { color: var(--color-muted, #887b91); }

.ui-loading--spinner {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  min-height: 180px;
  padding: 24px;
}

.ui-loading__spinner {
  width: 30px;
  height: 30px;
  border: 3px solid var(--color-surface, #fffaff);
  border-top-color: var(--color-accent, #ac82ba);
  border-radius: 50%;
  animation: ui-loading-spin 850ms linear infinite;
}

.ui-loading__label { font-size: 13px; line-height: 1.7; }

.ui-loading--skeleton {
  position: relative;
  display: grid;
  gap: 14px;
  min-height: 70vh;
  padding: 14px 0;
}

.ui-loading__bone {
  display: block;
  height: 86px;
  border-radius: 24px;
  background: linear-gradient(100deg, #eee8f2 8%, var(--color-surface, #fffaff) 18%, #eee8f2 33%);
  background-size: 200% 100%;
  animation: ui-loading-shimmer 1250ms linear infinite;
}

.ui-loading__bone:first-child { width: 48%; height: 54px; }
.ui-loading__bone:nth-last-child(2) { height: 280px; }

.ui-loading__label--hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

@keyframes ui-loading-spin { to { transform: rotate(360deg); } }
@keyframes ui-loading-shimmer { to { background-position: -200% 0; } }

@media (prefers-reduced-motion: reduce) {
  .ui-loading__spinner,
  .ui-loading__bone { animation: none; }
}
</style>
