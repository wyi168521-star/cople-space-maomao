<script setup lang="ts">
import SideNav from './SideNav.vue'
import BottomNav from './BottomNav.vue'
import type { NavigationItem, NavMember } from '~/types/navigation'

withDefaults(defineProps<{
  items: readonly NavigationItem[]
  active: string
  unreadCount?: number
  selfMember?: NavMember
  partnerMember?: NavMember
  partnerOnline?: boolean
}>(), { unreadCount: 0, partnerOnline: false })

const emit = defineEmits<{ select: [label: string]; settings: [] }>()
</script>

<template>
  <div class="app-shell">
    <slot name="before" />
    <SideNav
      :items="items"
      :active="active"
      :unread-count="unreadCount"
      :self-member="selfMember"
      :partner-member="partnerMember"
      :partner-online="partnerOnline"
      @select="emit('select', $event)"
      @settings="emit('settings')"
    />
    <slot />
    <BottomNav :items="items" :active="active" :unread-count="unreadCount" @select="emit('select', $event)" />
    <slot name="overlays" />
  </div>
</template>
