<script setup lang="ts">
import { onMounted, ref } from 'vue';

const status = ref('正在检查 API…');

onMounted(async () => {
  try {
    const response = await fetch('/api/health');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result: { status: string; database: string } = await response.json();
    status.value = `API ${result.status} · PostgreSQL ${result.database}`;
  } catch {
    status.value = 'API 暂时不可用';
  }
});
</script>

<template>
  <main>
    <p class="eyebrow">grounded-support</p>
    <h1>有据客服</h1>
    <p>虚构小家电商家的知识库客服项目。</p>
    <p class="status">{{ status }}</p>
    <p class="hint">当前是项目骨架；上传、检索和 AI 回答将在后续阶段实现。</p>
  </main>
</template>
