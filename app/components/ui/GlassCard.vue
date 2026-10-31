<script setup lang="ts">
withDefaults(defineProps<{
  as?: 'div' | 'section' | 'article' | 'aside' | 'header' | 'footer'
  padding?: 'none' | 'sm' | 'md' | 'lg'
}>(), {
  as: 'div',
  padding: 'md',
})
</script>

<template>
  <component :is="as" class="glass-panel ui-glass-card" :class="`ui-glass-card--${padding}`">
    <slot />
  </component>
</template>

<style scoped>
/* The shared glass-panel class supplies the existing app's glass treatment. */
.ui-glass-card {
  min-width: 0;
  border-radius: var(--radius-card, 24px);
  color: var(--color-ink, #44374f);
}

.ui-glass-card--none { padding: 0; }
.ui-glass-card--sm { padding: 16px; }
.ui-glass-card--md { padding: clamp(20px, 3vw, 28px); }
.ui-glass-card--lg { padding: clamp(24px, 4vw, 40px); }
</style>
