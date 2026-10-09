<script setup lang="ts">
import { computed, defineAsyncComponent, watch } from 'vue';
import { useRoute } from 'vue-router';
import AdminApp from './AdminApp.vue';
import { pageTitle } from './brand';
const IntegrationDocs = defineAsyncComponent(() => import('./IntegrationDocs.vue'));

const route = useRoute();
const isIntegrationDocs = computed(() => route.path === '/docs/integration');

watch(() => route.path, (path) => {
  document.title = pageTitle(path);
}, { immediate: true });
</script>

<template>
  <IntegrationDocs v-if="isIntegrationDocs" />
  <AdminApp v-else />
</template>
