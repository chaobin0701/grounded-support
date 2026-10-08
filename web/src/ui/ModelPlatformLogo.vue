<script setup lang="ts">
import { ServerCog } from '@lucide/vue';
import { modelPlatforms, type ModelPlatformKey } from '../model-platforms';

withDefaults(defineProps<{ platform: ModelPlatformKey; size?: number }>(), { size: 24 });
</script>

<template>
  <span class="model-platform-logo" :style="{ width: `${size}px`, height: `${size}px` }" aria-hidden="true">
    <img v-if="modelPlatforms[platform].logo" :src="modelPlatforms[platform].logo!" alt="" :width="size" :height="size" />
    <ServerCog v-else :size="size" />
  </span>
</template>

<style scoped>
.model-platform-logo { display: inline-flex; flex: none; align-items: center; justify-content: center; color: #64748b; }
.model-platform-logo img { display: block; width: 100%; height: 100%; object-fit: contain; }
</style>
