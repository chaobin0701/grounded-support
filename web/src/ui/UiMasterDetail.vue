<script setup lang="ts">
import { LoaderCircle } from '@lucide/vue';
defineProps<{ listLabel: string; count: string; busy?: boolean; empty?: boolean; emptyText?: string; detailLabel: string }>();
</script>

<template>
  <div class="ui-master-detail" :aria-busy="busy">
    <section class="ui-master-list" :aria-label="listLabel">
      <header class="ui-master-heading"><h2>{{ listLabel }}</h2><span><LoaderCircle v-if="busy" :size="13" class="ui-master-loading" aria-label="正在刷新" />{{ count }}</span></header>
      <div class="ui-master-records" tabindex="0" :aria-label="listLabel + '滚动区域'">
        <p v-if="empty" class="ui-master-empty" role="status">{{ busy ? '正在加载…' : emptyText || '没有匹配的记录' }}</p>
        <slot v-else name="list" />
      </div>
    </section>
    <aside class="ui-master-inspector" :aria-label="detailLabel"><slot name="detail" /></aside>
  </div>
</template>

<style scoped>
.ui-master-detail { display: grid; grid-template-columns: minmax(0,.9fr) minmax(340px,1.1fr); align-items: stretch; overflow: hidden; min-width: 0; border: 1px solid #e5e9f0; border-radius: 10px; background: #fff; }
.ui-master-list { min-width: 0; display: flex; flex-direction: column; }
.ui-master-heading { display: flex; flex: none; align-items: center; justify-content: space-between; gap: 12px; min-height: 52px; padding: 0 18px; border-bottom: 1px solid #edf0f4; }
.ui-master-heading h2 { margin: 0; color: #475467; font-size: 12px; font-weight: 600; }
.ui-master-heading > span { display: flex; align-items: center; gap: 7px; color: #98a2b3; font-size: 11px; }
.ui-master-records { min-height: 360px; max-height: min(680px,calc(100dvh - 270px)); overflow: auto; overscroll-behavior: contain; }
.ui-master-records:focus-visible { outline: 2px solid #2457e6; outline-offset: -2px; }
.ui-master-inspector { min-width: 0; max-height: min(732px,calc(100dvh - 218px)); overflow: auto; padding: 24px; border-left: 1px solid #e5e9f0; overscroll-behavior: contain; }
.ui-master-empty { padding: 40px 18px; color: #98a2b3; font-size: 13px; text-align: center; }
.ui-master-loading { animation: master-spin 1s linear infinite; }
.ui-master-records :deep(.management-item) { position: relative; display: flex; align-items: center; gap: 12px; width: 100%; min-height: 88px; padding: 16px 18px; border: 0; border-bottom: 1px solid #edf0f4; background: #fff; text-align: left; cursor: pointer; transition: background .15s ease; }
.ui-master-records :deep(.management-item:hover),.ui-master-records :deep(.management-item.selected) { background: #f5f8ff; }
.ui-master-records :deep(.management-item.selected::before) { content: ''; position: absolute; left: 0; top: 12px; bottom: 12px; width: 3px; border-radius: 2px; background: #2457e6; }
.ui-master-records :deep(.management-item:disabled) { cursor: wait; }
.ui-master-records :deep(.management-item:focus-visible) { outline: 2px solid #2457e6; outline-offset: -3px; }
.ui-master-records :deep(.management-item:last-child) { border-bottom: 0; }
@keyframes master-spin { to { transform: rotate(360deg); } }
@media (max-width: 1000px) { .ui-master-detail { grid-template-columns: minmax(0,1fr); }.ui-master-records { min-height: 150px; max-height: 320px; }.ui-master-inspector { border-left: 0; border-top: 1px solid #e5e9f0; max-height: none; } }
@media (max-width: 520px) { .ui-master-inspector { padding: 18px; }.ui-master-records :deep(.management-item) { padding: 14px; gap: 10px; } }
@media (prefers-reduced-motion: reduce) { .ui-master-loading { animation: none; }.ui-master-records :deep(.management-item) { transition: none; } }
</style>
