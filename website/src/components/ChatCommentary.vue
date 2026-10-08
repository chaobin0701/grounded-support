<script setup lang="ts">
import { computed } from "vue";
import { commentaryLines } from "../chat/progress";
import type { ProcessEvent } from "../chat/types";
const props = defineProps<{ events: ProcessEvent[] }>();
const current = computed(() => commentaryLines(props.events).at(-1));
</script>
<template>
  <p v-if="current" class="chat-commentary" role="status" aria-live="polite" aria-atomic="true">{{ current.text }}</p>
</template>
