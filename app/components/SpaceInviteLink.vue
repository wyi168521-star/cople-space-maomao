<script setup lang="ts">
import { Check, Copy, Link2 } from '@lucide/vue'
import { computed, onMounted, ref, watch } from 'vue'
import { buildPairingInvite } from '../utils/pairingInvite'

const props = defineProps<{ coupleId: string }>()
const origin = ref('')
const linkInput = ref<HTMLTextAreaElement | null>(null)
const copying = ref(false)
const copied = ref(false)
const status = ref('')
const inviteLink = computed(() => buildPairingInvite(origin.value, props.coupleId))
onMounted(() => { origin.value = window.location.origin })
watch(inviteLink, () => { copied.value = false; status.value = '' })

async function copyInvitation() {
  if (!inviteLink.value || copying.value) return
  copying.value = true; copied.value = false; status.value = ''
  const current = inviteLink.value
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
    await navigator.clipboard.writeText(current)
    if (inviteLink.value !== current) return
    copied.value = true; status.value = '邀请链接已复制，发给另一半，TA 点开后即可确认加入。'
  } catch {
    if (inviteLink.value !== current) return
    linkInput.value?.focus(); linkInput.value?.select()
    status.value = '暂时无法自动复制，请长按或手动复制上方完整链接。'
  } finally { copying.value = false }
}
</script>

<template>
  <section class="love-flow__space-box love-flow__invite-box" aria-labelledby="space-invite-label">
    <label id="space-invite-label" for="space-invite-url"><Link2 :size="17" aria-hidden="true" />专属邀请链接</label>
    <p id="space-invite-help">把这份邀请发给另一半，登录或注册后，轻点确认就能加入。</p>
    <textarea id="space-invite-url" ref="linkInput" class="love-flow__space-id" :value="inviteLink" readonly rows="4" aria-describedby="space-invite-help" @focus="linkInput?.select()" />
    <button class="love-flow__primary" type="button" :disabled="!inviteLink || copying" @click="copyInvitation">
      <Check v-if="copied" :size="18" aria-hidden="true" /><Copy v-else :size="18" aria-hidden="true" />{{ copied ? '已复制邀请链接' : copying ? '正在复制…' : '复制邀请链接' }}
    </button>
    <p class="love-flow__copy-status" role="status" aria-live="polite">{{ status }}</p>
  </section>
</template>
