<script setup lang="ts">
import { siteBrand } from '../brand';
</script>

<template>
  <img class="brand-mark hexu-brand-mark" :src="siteBrand.icon" alt="" aria-hidden="true" width="40" height="40" />
</template>

<style scoped>
.hexu-brand-mark { display: block; flex: none; object-fit: contain; background: transparent !important; }
</style>
