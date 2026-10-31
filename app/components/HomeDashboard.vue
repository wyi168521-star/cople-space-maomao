<script setup lang="ts">
import { BookOpen, Images, ListChecks, MessageCircleHeart, RefreshCw } from '@lucide/vue'
import DashboardNumber from './DashboardNumber.vue'
import { useDashboard, type DashboardKey } from '../composables/useDashboard'
import '../styles/home-dashboard.css'

const { stats, loading, refresh } = useDashboard()
const cards = [
  { key: 'memories', label: '共同回忆', unit: '段', icon: BookOpen, note: '写下的每个瞬间' },
  { key: 'whispers', label: '悄悄话', unit: '条', icon: MessageCircleHeart, note: '只说给你听的话' },
  { key: 'photos', label: '珍藏照片', unit: '张', icon: Images, note: '相册与时光轴照片' },
  { key: 'wishes', label: '已完成心愿', unit: '个', icon: ListChecks, note: '一起实现的小美好' },
] satisfies { key: DashboardKey; label: string; unit: string; icon: typeof BookOpen; note: string }[]
const failures = computed(() => cards.filter(card => stats.value[card.key].error))
</script>

<template>
  <section class="love-dashboard" aria-labelledby="dashboard-heading">
    <header class="love-dashboard__header">
      <div>
        <p class="love-dashboard__eyebrow">OUR LITTLE NUMBERS</p>
        <h2 id="dashboard-heading">把日子，过成我们的故事</h2>
      </div>
      <button type="button" class="love-dashboard__refresh" :disabled="loading"
        :aria-label="loading ? '正在更新数据看板' : '刷新数据看板'" @click="refresh">
        <RefreshCw :size="17" :class="{ 'love-flow__spinner': loading }" aria-hidden="true" />
      </button>
    </header>
    <div class="love-dashboard__grid">
      <article v-for="card in cards" :key="card.key" class="love-glass love-dashboard__card"
        :data-stat="card.key" :aria-busy="stats[card.key].loading" :aria-label="card.label">
        <component :is="card.icon" :size="20" class="love-dashboard__icon" aria-hidden="true" />
        <h3>{{ card.label }}</h3>
        <div class="love-dashboard__value" :data-testid="`dashboard-${card.key}`">
          <DashboardNumber :value="stats[card.key].count" />
          <span class="love-dashboard__unit" aria-hidden="true">{{ card.unit }}</span>
        </div>
        <p>{{ stats[card.key].loading ? '正在数一数…' : stats[card.key].error ? '暂时未能读取' : card.note }}</p>
      </article>
    </div>
    <div v-if="failures.length" class="love-dashboard__error" role="alert">
      <p>部分数据暂不可用，点击上方刷新按钮重试。</p>
      <p v-for="card in failures" :key="card.key">{{ card.label }}：{{ stats[card.key].error }}</p>
    </div>
    <p v-else class="love-dashboard__footnote" role="status">{{ loading ? '正在整理属于你们的小小足迹。' : '一点一滴，都是我们一起生活的证明。' }}</p>
  </section>
</template>
