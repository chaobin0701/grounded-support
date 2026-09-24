<script setup lang="ts">
defineProps<{
  eyebrow?: string;
  title: string;
  description?: string;
}>();
</script>

<template>
  <header class="admin-page-header">
    <div class="admin-page-header-copy">
      <slot name="breadcrumb" />
      <p v-if="eyebrow" class="admin-page-header-eyebrow">{{ eyebrow }}</p>
      <div class="admin-page-header-title-row">
        <h1>{{ title }}</h1>
        <slot name="badge" />
      </div>
      <p v-if="description" class="admin-page-header-description">{{ description }}</p>
    </div>
    <div v-if="$slots.actions" class="admin-page-header-actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped>
.admin-page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  min-width: 0;
  margin: 0 0 24px;
  padding: 0 0 22px;
  border-bottom: 1px solid #e5e9f0;
}

.admin-page-header-copy {
  min-width: 0;
}

.admin-page-header-eyebrow {
  margin: 0 0 8px;
  color: #718096;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: .035em;
}

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

.admin-page-header-description {
  max-width: 760px;
  margin: 9px 0 0;
  color: #748094;
  font-size: 13px;
  line-height: 1.6;
}

.admin-page-header-actions {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 20px;
}

:slotted(.admin-page-header-breadcrumb) {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 9px;
  color: #8a96a8;
  font-size: 12px;
}

:slotted(.admin-page-header-badge) {
  flex: none;
}

.admin-page-header-actions > :slotted(*) {
  flex: 0 0 auto;
  max-width: 100%;
  white-space: nowrap;
}

@media (max-width: 720px) {
  .admin-page-header {
    flex-direction: column;
    gap: 14px;
    margin-bottom: 20px;
    padding-bottom: 18px;
  }

  .admin-page-header-actions {
    width: 100%;
    justify-content: flex-start;
    padding-top: 0;
  }
}

</style>
