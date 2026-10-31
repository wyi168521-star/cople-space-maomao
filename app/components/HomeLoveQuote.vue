<script setup lang="ts">
import { Feather, LoaderCircle, RefreshCw } from '@lucide/vue'
defineProps<{ text: string; loading: boolean; isFallback: boolean; notice: string }>()
defineEmits<{ retry: [] }>()
</script>

<template>
  <section class="love-glass home-ai-quote" aria-labelledby="today-quote-heading" :aria-busy="loading"
    :data-source="isFallback ? 'local' : 'ai'">
    <header class="home-ai-quote__header">
      <div><Feather :size="16" aria-hidden="true" /><h2 id="today-quote-heading">今日情话</h2></div>
      <button type="button" class="home-ai-quote__retry" aria-label="重新生成情话" :disabled="loading" @click="$emit('retry')">
        <LoaderCircle v-if="loading" :size="17" class="love-flow__spinner" aria-hidden="true" />
        <RefreshCw v-else :size="17" aria-hidden="true" />
      </button>
    </header>
    <div class="home-ai-quote__text" aria-live="polite" aria-atomic="true">
      <Transition name="ai-quote" mode="out-in" appear>
        <blockquote :key="`${isFallback}:${text}`">{{ text }}</blockquote>
      </Transition>
    </div>
    <p class="home-ai-quote__status" role="status">
      {{ loading ? '正在为你写下一句心动…' : notice || (isFallback ? '先送你一句小家的情话。' : '把今天的喜欢，轻轻说给你听。') }}
    </p>
  </section>
</template>
