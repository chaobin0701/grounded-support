<script setup lang="ts">
import { computed, defineAsyncComponent, watch } from 'vue';
import { useRoute } from 'vue-router';
import AdminApp from './AdminApp.vue';
import ChatWorkspace from './ChatWorkspace.vue';
import { pageTitle } from './brand';
const IntegrationDocs = defineAsyncComponent(() => import('./IntegrationDocs.vue'));

const route = useRoute();
const isAdminRoute = computed(() => route.path === '/admin' || route.path.startsWith('/admin/'));
const isIntegrationDocs = computed(() => route.path === '/docs/integration');
const isLegacyEmbeddedChat = computed(() => route.path === '/' && route.query.embed === '1');

watch(() => route.path, (path) => {
  document.title = pageTitle(path);
}, { immediate: true });
</script>

<template>
  <IntegrationDocs v-if="isIntegrationDocs" />
  <AdminApp v-else-if="isAdminRoute" />
  <ChatWorkspace v-else :mode="isLegacyEmbeddedChat ? 'widget' : 'full'" />
</template>
