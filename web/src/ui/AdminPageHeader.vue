<script setup lang="ts">
import { ArrowLeft } from '@lucide/vue';

defineProps<{
  title: string;
  backTo?: string;
  backLabel?: string;
}>();
</script>

<template>
  <header class="admin-page-header">
    <nav v-if="backTo || $slots.breadcrumb" class="admin-page-header-navigation" aria-label="页面导航">
      <RouterLink v-if="backTo" :to="backTo" class="admin-page-header-back"><ArrowLeft :size="15" aria-hidden="true" />{{ backLabel || '返回列表' }}</RouterLink>
      <slot name="breadcrumb" />
    </nav>
    <div class="admin-page-header-copy">
      <div class="admin-page-header-title-row">
        <h1>{{ title }}</h1>
        <slot name="badge" />
      </div>
    </div>
    <div v-if="$slots.actions" class="admin-page-header-actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped>
.admin-page-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px 24px;
  min-width: 0;
  margin: 0 0 24px;
  padding: 0 0 18px;
  border-bottom: 1px solid #e5e9f0;
}

.admin-page-header-copy { min-width: 0; }

.admin-page-header-navigation {
  display: flex;
  grid-column: 1 / -1;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 20px;
  min-width: 0;
}

.admin-page-header-back {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 36px;
  border-radius: 5px;
  color: #667085;
  font-size: 13px;
  text-decoration: none;
}
.admin-page-header-back svg { flex: none; }
.admin-page-header-back:hover { color: #2457e6; }
.admin-page-header-back:focus-visible { outline: 2px solid #2457e6; outline-offset: 4px; }

.admin-page-header-title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.admin-page-header h1 {
  min-width: 0;
  margin: 0;
  color: #172033;
  font-size: clamp(25px, 2.3vw, 30px);
  font-weight: 650;
  letter-spacing: -.035em;
  line-height: 1.2;
  overflow-wrap: anywhere;
}

.admin-page-header-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}

:slotted(.admin-page-header-breadcrumb) {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: #8a96a8;
  font-size: 12px;
}

:slotted(.admin-page-header-badge) { flex: none; }

.admin-page-header-actions > :slotted(*) {
  flex: 0 0 auto;
  max-width: 100%;
  white-space: nowrap;
}

@media (max-width: 720px) {
  .admin-page-header {
    grid-template-columns: minmax(0, 1fr);
    gap: 14px;
    margin-bottom: 20px;
    padding-bottom: 18px;
  }
  .admin-page-header-actions { width: 100%; justify-content: flex-start; }
  .admin-page-header-back { min-height: 44px; }
}
</style>
