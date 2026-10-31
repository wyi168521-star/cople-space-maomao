<script setup lang="ts">
withDefaults(defineProps<{
  title?: string
  description?: string
  headingAs?: 'h2' | 'h3' | 'h4'
}>(), {
  title: '还没有内容',
  description: '',
  headingAs: 'h2',
})
</script>

<template>
  <section class="ui-empty-state">
    <div class="ui-empty-state__icon" aria-hidden="true">
      <slot name="icon">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" focusable="false">
          <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />
        </svg>
      </slot>
    </div>
    <component :is="headingAs" class="ui-empty-state__title">
      <slot name="title">{{ title }}</slot>
    </component>
    <p v-if="description || $slots.description" class="ui-empty-state__description">
      <slot name="description">{{ description }}</slot>
    </p>
    <div v-if="$slots.actions" class="ui-empty-state__actions">
      <slot name="actions" />
    </div>
  </section>
</template>

<style scoped>
.ui-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: clamp(32px, 6vw, 64px) 20px;
  text-align: center;
}

.ui-empty-state__icon {
  display: grid;
  place-items: center;
  width: 68px;
  height: 68px;
  margin-bottom: 18px;
  border-radius: 24px;
  background: var(--color-surface, #fffaff);
  color: var(--color-accent, #ac82ba);
}

.ui-empty-state__title {
  margin: 0;
  color: var(--color-ink, #44374f);
  font-size: clamp(18px, 3vw, 24px);
  font-weight: 750;
}

.ui-empty-state__description {
  max-width: 34rem;
  margin: 12px 0 0;
  color: var(--color-muted, #887b91);
  font-size: 14px;
  line-height: 1.8;
  overflow-wrap: anywhere;
}

.ui-empty-state__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  margin-top: 24px;
}
</style>
