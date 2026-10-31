<script setup lang="ts">
import type { NavigationItem } from '~/types/navigation'

withDefaults(defineProps<{
  items: readonly NavigationItem[]
  active: string
  unreadCount?: number
}>(), { unreadCount: 0 })

const emit = defineEmits<{ select: [label: string] }>()
</script>

<template>
  <nav class="mobile-nav glass-panel" aria-label="手机主要导航">
    <button
      v-for="item in items"
      :key="item.label"
      class="mobile-nav-button"
      :class="{ active: active === item.label }"
      type="button"
      :aria-label="item.label"
      :aria-current="active === item.label ? 'page' : undefined"
      @click.stop="emit('select', item.label)"
    >
      <component :is="item.icon" :size="21" aria-hidden="true" />
      <span>{{ item.label }}</span>
      <strong v-if="item.label === '悄悄话' && unreadCount" class="nav-unread">{{ unreadCount > 9 ? '9+' : unreadCount }}</strong>
    </button>
  </nav>
</template>
