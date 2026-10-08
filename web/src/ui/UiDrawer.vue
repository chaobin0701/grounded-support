<script setup lang="ts">
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui';
import { X } from '@lucide/vue';
defineProps<{ open: boolean; title: string }>();
const emit = defineEmits<{ 'update:open': [value: boolean] }>();
</script>
<template>
  <DialogRoot :open="open" @update:open="emit('update:open', $event)"
    ><DialogPortal>
      <DialogOverlay class="drawer-overlay" />
      <DialogContent class="ui-drawer"
        ><header class="drawer-header">
          <DialogTitle>{{ title }}</DialogTitle
          ><DialogClose aria-label="关闭轨迹面板"><X :size="18" /></DialogClose>
        </header>
        <DialogDescription class="sr-only"
          >查看所选对话轮次的执行过程和上下文。</DialogDescription
        >
        <div class="drawer-content"><slot /></div
      ></DialogContent> </DialogPortal
  ></DialogRoot>
</template>
<style scoped>
.drawer-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: #17203355;
  backdrop-filter: blur(2px);
}
.ui-drawer {
  position: fixed;
  inset: 0 0 0 auto;
  z-index: 51;
  display: flex;
  flex-direction: column;
  width: min(520px, 100%);
  height: 100dvh;
  background: #fff;
  border-left: 1px solid #e3e8ef;
  box-shadow: -16px 0 50px #17203318;
}
.drawer-header {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px;
  border-bottom: 1px solid #e3e8ef;
  color: #172033;
  font-size: 16px;
  font-weight: 650;
}
.drawer-header button {
  display: grid;
  place-items: center;
  min-width: 32px;
  min-height: 32px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #667085;
}
.drawer-header button:hover {
  background: #f2f4f7;
}
.drawer-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
</style>
