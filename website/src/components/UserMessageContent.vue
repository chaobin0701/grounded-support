<script setup lang="ts">
import { computed } from "vue";
import { Package } from "@lucide/vue";
import { documentParts, messageDocument } from "../chat/inline-document";
import type { ChatMessage } from "../chat/types";
const props = defineProps<{ message: ChatMessage }>();
const parts = computed(() => {
  const doc = messageDocument(props.message.content, props.message.context);
  return documentParts(doc.text, doc.products);
});
</script>
<template>
  <p class="chat-message-text chat-user-content"><template v-for="(part, index) in parts" :key="index"><span v-if="part.type === 'product'" class="chat-inline-product chat-inline-product--readonly"><Package :size="14" aria-hidden="true" /><span :title="part.product.name">{{ part.product.name }}</span></span><span v-else class="chat-user-text-segment">{{ part.text }}</span></template></p>
</template>
