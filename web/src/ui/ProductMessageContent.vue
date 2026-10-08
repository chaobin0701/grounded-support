<script setup lang="ts">
import { computed } from 'vue';
import { Package } from '@lucide/vue';
import type { ConversationMessage } from '../chat-api';
import { productMessageParts } from '../product-message';
const props = defineProps<{ content: string; context?: ConversationMessage['context'] }>();
const parts = computed(() => productMessageParts(props.content, props.context));
</script>
<template>
  <p class="product-message-content"><template v-for="(part, index) in parts" :key="index"><span v-if="part.type === 'product'" class="product-message-reference" :title="part.id"><Package :size="14" aria-hidden="true" /><span>{{ part.name }}</span></span><span v-else class="product-message-text-segment">{{ part.text }}</span></template></p>
</template>
<style scoped>
.product-message-content { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.product-message-reference { display: inline-flex; align-items: center; vertical-align: middle; gap: 5px; max-width: calc(100% - 8px); padding: 0 8px; margin-inline: 4px; border-radius: 4px; background: #e8f2ee; color: #176b5b; font: inherit; line-height: inherit; }
.product-message-reference > svg { width: 1em; height: 1em; flex-shrink: 0; }
.product-message-reference > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.product-message-text-segment { vertical-align: middle; }
</style>
