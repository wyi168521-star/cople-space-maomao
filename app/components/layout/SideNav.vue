<script setup lang="ts">
import { Settings } from '@lucide/vue'
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
  <aside class="sidebar glass-panel" aria-label="主要导航">
    <button class="couple-mark" type="button" aria-label="我们的主页" @click="emit('select', '首页')">
      <span class="avatar avatar-left">
        <img v-if="selfMember?.avatarUrl" :src="selfMember.avatarUrl" alt="我的头像">
        <template v-else>{{ selfMember?.displayName?.slice(0, 1) || '我' }}</template>
      </span>
      <span class="avatar avatar-right">
        <img v-if="partnerMember?.avatarUrl" :src="partnerMember.avatarUrl" alt="伴侣头像">
        <template v-else>{{ partnerMember?.displayName?.slice(0, 1) || '待' }}</template>
      </span>
      <span class="online-dot" :class="{ offline: !partnerOnline }" aria-hidden="true" />
    </button>

    <nav class="nav-list" aria-label="桌面页面导航">
      <button
        v-for="item in items"
        :key="item.label"
        class="nav-button"
        :class="{ active: active === item.label }"
        type="button"
        :aria-label="item.label"
        :aria-current="active === item.label ? 'page' : undefined"
        :title="item.label"
        @click.stop="emit('select', item.label)"
      >
        <component :is="item.icon" :size="21" :stroke-width="1.8" aria-hidden="true" />
        <span>{{ item.label }}</span>
        <strong v-if="item.label === '悄悄话' && unreadCount" class="nav-unread">{{ unreadCount > 9 ? '9+' : unreadCount }}</strong>
      </button>
    </nav>

    <button class="nav-button settings-button" type="button" title="设置" aria-label="设置" @click="emit('settings')">
      <Settings :size="21" :stroke-width="1.8" aria-hidden="true" />
      <span>设置</span>
    </button>
  </aside>
</template>
