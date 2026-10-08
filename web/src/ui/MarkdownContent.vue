<script setup lang="ts">
import { computed } from 'vue';
import { renderSafeMarkdown } from '../markdown';
const props = defineProps<{ content: string }>();
const rendered = computed(() => renderSafeMarkdown(props.content));
</script>
<template><div class="markdown-content" v-html="rendered" /></template>
<style scoped>
.markdown-content {
  min-width: 0;
  font-size: 14px;
  line-height: 1.85;
  color: #344054;
  overflow-wrap: anywhere;
}
.markdown-content :deep(p) {
  margin: 0 0 12px;
}
.markdown-content :deep(> :last-child) {
  margin-bottom: 0;
}
.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  margin: 10px 0;
  padding-left: 23px;
  list-style-type: disc;
}
.markdown-content :deep(ol) {
  list-style-type: decimal;
}
.markdown-content :deep(li) {
  margin: 4px 0;
}
.markdown-content :deep(h1),
.markdown-content :deep(h2),
.markdown-content :deep(h3) {
  margin: 18px 0 8px;
  font-size: 15px;
  font-weight: 650;
}
.markdown-content :deep(strong) {
  font-weight: 650;
}
.markdown-content :deep(a) {
  color: #2457e6;
  text-decoration: underline;
}
.markdown-content :deep(pre) {
  max-width: 100%;
  overflow: auto;
  padding: 14px;
  border-radius: 8px;
  background: #f6f8fb;
  font:
    12px/1.7 ui-monospace,
    monospace;
}
.markdown-content :deep(blockquote) {
  margin: 10px 0;
  padding-left: 12px;
  border-left: 3px solid #dbe3ef;
  color: #64748b;
}
.markdown-content :deep(table) {
  display: block;
  max-width: 100%;
  overflow: auto;
  border-collapse: collapse;
  font-size: 12px;
}
.markdown-content :deep(th),
.markdown-content :deep(td) {
  padding: 8px 10px;
  border: 1px solid #e2e8f0;
}
</style>
