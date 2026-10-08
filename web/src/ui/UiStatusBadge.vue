<script setup lang="ts">
withDefaults(defineProps<{ tone?: 'neutral' | 'success' | 'warning' }>(), { tone: 'neutral' });
</script>
<template><span class="ui-status-badge" :class="tone"><slot /></span></template>
<style scoped>
.ui-status-badge { display: inline-flex; flex: none; align-items: center; gap: 5px; width: max-content; max-width: 100%; padding: 3px 8px; border-radius: 5px; background: #f2f4f7; color: #667085; font-size: 11px; font-weight: 500; line-height: 1.6; }
.ui-status-badge.success { background: #edf8f2; color: #25825c; }
.ui-status-badge.warning { background: #fff6e5; color: #a16b13; }
</style>
