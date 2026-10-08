<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId } from "vue";
import { ChevronDown, RefreshCw, X } from "@lucide/vue";
import { chat } from "../chat/service";
import { quotaPercent, quotaStatusText } from "../chat/quota";

const { state } = chat;
const id = useId();
const opened = ref(false);
const anchor = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const quota = computed(() => state.quota);
const status = computed(() => quotaStatusText(state.quotaStatus));
const tokenMeter = computed(() => quota.value?.tokenLimit != null);
const percent = computed(() => !quota.value ? 0 : tokenMeter.value
  ? quotaPercent(quota.value.totalTokens, quota.value.reservedTokens, quota.value.tokenLimit) ?? 0
  : quotaPercent(quota.value.requests, 0, quota.value.requestLimit) ?? 0);
const available = computed(() => !!quota.value && !state.quotaError);
const label = computed(() => tokenMeter.value ? "今日共享 Token 占用（含预留）" : "今日共享请求次数");
const format = (value: number) => value.toLocaleString("zh-CN");
const resetTime = computed(() => quota.value ? new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
}).format(new Date(quota.value.resetAt)) : "");

function close(focus = false) {
  opened.value = false;
  if (focus) trigger.value?.focus();
}
async function toggle() {
  opened.value = !opened.value;
  if (opened.value) {
    void chat.refreshQuota();
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
  <div ref="anchor" class="chat-quota" :class="{ 'chat-quota--warning': percent >= 90 || !!status }" @keydown.esc.stop.prevent="close(true)">
    <button ref="trigger" type="button" class="chat-quota-trigger" :aria-expanded="opened" :aria-controls="`${id}-panel`" aria-haspopup="dialog"
      :aria-label="`官网共享额度，${available ? `${label} ${Math.round(percent)}%` : '暂时未知'}${status ? `，${status}` : ''}，查看详情`" @click="toggle">
      <span>额度</span>
      <span class="chat-quota-track chat-quota-mini" aria-hidden="true"><span :style="{ width: available ? `${percent}%` : '0%' }"></span></span>
      <span class="chat-quota-value">{{ available ? `${Math.round(percent)}%` : state.quotaLoading ? '查询中' : '未知' }}</span>
      <ChevronDown :size="12" :class="{ rotated: opened }" />
    </button>
    <section v-if="opened" :id="`${id}-panel`" ref="panel" class="chat-quota-popover" role="dialog" :aria-labelledby="`${id}-title`" tabindex="-1">
      <header><strong :id="`${id}-title`">官网共享额度</strong><button type="button" class="chat-quota-icon" aria-label="关闭额度详情" @click="close(true)"><X :size="15" /></button></header>
      <div class="chat-quota-body">
        <p v-if="state.quotaError" class="chat-quota-hint" role="status">{{ state.quotaError }}{{ quota ? '，以下为上次统计。' : '，请稍后重试。' }}</p>
        <template v-if="quota">
          <div class="chat-quota-heading"><strong>今日次数</strong><span>{{ format(quota.requests) }} / {{ format(quota.requestLimit) }}</span></div>
          <dl class="chat-quota-details"><dt>剩余次数</dt><dd>{{ format(quota.remainingRequests) }}</dd></dl>
          <div class="chat-quota-heading"><strong>Token</strong><span>{{ format(quota.totalTokens) }} / {{ quota.tokenLimit === null ? '不限' : format(quota.tokenLimit) }}</span></div>
          <dl class="chat-quota-details">
            <dt>预留中</dt><dd>{{ format(quota.reservedTokens) }}</dd>
            <dt>剩余额度</dt><dd>{{ quota.remainingTokens === null ? '不限' : format(quota.remainingTokens) }}</dd>
          </dl>
          <div v-if="available" class="chat-quota-track" role="progressbar" :aria-label="label" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="Math.round(percent)"><span :style="{ width: `${percent}%` }"></span></div>
          <p class="chat-quota-hint">所有访客共享 · 北京时间 {{ resetTime }} 重置</p>
          <p v-if="quota.unknownModelCalls" class="chat-quota-hint">部分用量为保守估算，不等同于供应商账单。</p>
          <p v-if="status" class="chat-quota-status" role="status">{{ status }}</p>
        </template>
        <p v-else-if="!state.quotaError" class="chat-quota-hint" role="status">正在查询额度…</p>
      </div>
      <footer><button type="button" :disabled="state.quotaLoading" @click="chat.refreshQuota(true)"><RefreshCw :size="13" />{{ state.quotaLoading ? '刷新中…' : '刷新额度' }}</button></footer>
    </section>
  </div>
</template>
