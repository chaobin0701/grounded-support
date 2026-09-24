<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue';

const props = withDefaults(defineProps<{ message?: string; type?: 'success' | 'error' }>(), { type: 'success' });
const emit = defineEmits<{ dismiss: [] }>();
const visible = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;

watch(() => props.message, (message) => {
  if (timer) clearTimeout(timer);
  visible.value = !!message;
  if (message) timer = setTimeout(() => { visible.value = false; emit('dismiss'); }, 4200);
}, { immediate: true });
onUnmounted(() => { if (timer) clearTimeout(timer); });
</script>

<template>
  <Transition name="toast-slide">
    <div v-if="visible && message" class="toast-notice" :class="`toast-${type}`" :role="type === 'error' ? 'alert' : 'status'" aria-live="polite">
      <span class="toast-indicator" aria-hidden="true"></span>
      <span class="toast-message">{{ message }}</span>
      <button type="button" class="toast-close" aria-label="关闭提醒" @click="visible = false; emit('dismiss')">×</button>
    </div>
  </Transition>
</template>

<style scoped>
.toast-notice{position:fixed;z-index:1000;right:24px;bottom:24px;display:flex;align-items:center;gap:10px;max-width:min(420px,calc(100vw - 32px));min-height:46px;padding:0 12px 0 15px;border:1px solid #dce8df;border-radius:10px;background:#fff;box-shadow:0 12px 34px rgba(24,42,31,.16);color:#344054;font-size:13px}.toast-indicator{width:8px;height:8px;flex:none;border-radius:50%;background:#2d9d67}.toast-error{border-color:#f2d2ce}.toast-error .toast-indicator{background:#d0443e}.toast-message{line-height:1.5}.toast-close{width:25px;height:25px;margin-left:5px;border:0;border-radius:5px;background:transparent;color:#98a2b3;font-size:18px;line-height:1;cursor:pointer}.toast-close:hover{background:#f3f5f7;color:#475467}.toast-slide-enter-active,.toast-slide-leave-active{transition:opacity .2s ease,transform .2s ease}.toast-slide-enter-from,.toast-slide-leave-to{opacity:0;transform:translateY(10px)}
@media(max-width:620px){.toast-notice{right:16px;bottom:16px}}
</style>
