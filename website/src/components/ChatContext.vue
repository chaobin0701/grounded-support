<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId } from "vue";
import { ChevronDown, X } from "@lucide/vue";
import { chat } from "../chat/service";

const { state } = chat;
const id = useId();
const opened = ref(false);
const anchor = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const context = computed(() => state.lastContext);
const format = (value: number) => value.toLocaleString("zh-CN");

function close(focus = false) {
  opened.value = false;
  if (focus) trigger.value?.focus();
}
async function toggle() {
  if (!context.value) return;
  opened.value = !opened.value;
  if (opened.value) {
    await nextTick();
    panel.value?.focus();
  }
}
function outside(event: PointerEvent) {
  if (event.target instanceof Node && !anchor.value?.contains(event.target)) close();
}
function focusOutside(event: FocusEvent) {
  if (opened.value && event.target instanceof Node && !anchor.value?.contains(event.target)) close();
}
onMounted(() => {
  document.addEventListener("pointerdown", outside);
  document.addEventListener("focusin", focusOutside);
});
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", outside);
  document.removeEventListener("focusin", focusOutside);
});
</script>

<template>
  <div v-if="context" ref="anchor" class="chat-context" @keydown.esc.stop.prevent="close(true)">
    <button ref="trigger" type="button" class="chat-context-trigger" :aria-expanded="opened" :aria-controls="`${id}-panel`" aria-haspopup="dialog"
      :aria-label="`当前上下文约 ${format(context.estimatedInputTokens)} / ${format(context.inputBudgetTokens)} tokens，查看详情`" @click="toggle">
      <span>上下文</span>
      <span class="chat-context-value">{{ Math.round(context.usagePercent) }}%</span>
      <ChevronDown :size="12" :class="{ rotated: opened }" />
    </button>
    <section v-if="opened" :id="`${id}-panel`" ref="panel" class="chat-context-popover" role="dialog" :aria-labelledby="`${id}-title`" tabindex="-1">
      <header><strong :id="`${id}-title`">当前上下文</strong><button type="button" class="chat-context-icon" aria-label="关闭上下文详情" @click="close(true)"><X :size="15" /></button></header>
      <div class="chat-context-body">
        <div class="chat-context-heading"><strong>输入空间</strong><span>约 {{ Math.round(context.usagePercent) }}%</span></div>
        <div class="chat-context-track" role="progressbar" aria-label="当前上下文占用" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="Math.round(context.usagePercent)"><span :style="{ width: `${Math.min(context.usagePercent, 100)}%` }"></span></div>
        <dl class="chat-context-details">
          <dt>估算占用</dt><dd>{{ format(context.estimatedInputTokens) }} tokens</dd>
          <dt>可用输入预算</dt><dd>{{ format(context.inputBudgetTokens) }} tokens</dd>
          <dt>估算剩余</dt><dd>{{ format(context.remainingInputTokens) }} tokens</dd>
        </dl>
      </div>
    </section>
  </div>
</template>
