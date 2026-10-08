<script setup lang="ts">
import { RefreshCw } from "@lucide/vue";
defineProps<{ loading: boolean; error: string; empty?: boolean }>();
defineEmits<{ retry: [] }>();
</script>

<template>
  <div v-if="loading" class="catalog-state" role="status">
    <RefreshCw class="spinner" :size="22" />
    <p>正在加载产品资料…</p>
  </div>
  <div v-else-if="error" class="catalog-state" role="alert">
    <h2>暂时无法读取产品资料</h2>
    <p>{{ error }}</p>
    <button type="button" class="button button-outline" @click="$emit('retry')">
      <RefreshCw :size="16" />重新加载
    </button>
  </div>
  <div v-else-if="empty" class="catalog-state">
    <h2>没有找到匹配的产品</h2>
    <p>试试其他分类或关键词。</p>
  </div>
</template>
