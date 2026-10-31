<script setup lang="ts">
withDefaults(defineProps<{
  /** Change this key when switching the content shown in the default slot. */
  transitionKey?: string | number
  mode?: 'out-in' | 'in-out'
  appear?: boolean
}>(), {
  transitionKey: 'page',
  mode: 'out-in',
  appear: false,
})
</script>

<template>
  <Transition name="ui-page" :mode="mode" :appear="appear">
    <div :key="transitionKey" class="ui-page-transition">
      <slot />
    </div>
  </Transition>
</template>

<style scoped>
.ui-page-transition { min-width: 0; }

.ui-page-enter-active,
.ui-page-leave-active {
  transition: opacity 200ms ease, transform 200ms ease;
}

.ui-page-enter-from,
.ui-page-leave-to {
  opacity: 0;
  transform: translateY(6px);
}

@media (prefers-reduced-motion: reduce) {
  .ui-page-enter-active,
  .ui-page-leave-active { transition: none; }

  .ui-page-enter-from,
  .ui-page-leave-to { transform: none; }
}
</style>
