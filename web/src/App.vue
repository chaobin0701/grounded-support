<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import AdminApp from './AdminApp.vue';
import ChatWorkspace from './ChatWorkspace.vue';
import HelpCenter from './HelpCenter.vue';
import ProductSite from './ProductSite.vue';

const route = useRoute();
const isAdminRoute = computed(() => route.path === '/admin' || route.path.startsWith('/admin/'));
const isProductRoute = computed(() => route.path === '/product' || route.path.startsWith('/product/'));
const isHelpRoute = computed(() => route.path === '/help');
const isLegacyEmbeddedChat = computed(() => route.path === '/' && route.query.embed === '1');

watch(() => route.path, (path) => {
  document.title = path === '/product' || path.startsWith('/product/') ? '暖巢智能客服 · 产品介绍'
    : path === '/help' ? '暖巢智能客服 · 帮助中心'
      : path.startsWith('/admin') ? '暖巢智能客服 · 管理中心' : '暖巢智能客服';
}, { immediate: true });
</script>

<template>
  <ProductSite v-if="isProductRoute" />
  <HelpCenter v-else-if="isHelpRoute" />
  <AdminApp v-else-if="isAdminRoute" />
  <ChatWorkspace v-else :mode="isLegacyEmbeddedChat ? 'widget' : 'full'" />
</template>
