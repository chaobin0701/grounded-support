<script setup lang="ts">
import { computed } from "vue";
import DOMPurify from "dompurify";
const props = defineProps<{ text: string }>();
const markup = computed(() =>
  DOMPurify.sanitize(props.text, {
    ALLOWED_TAGS: [
      "p",
      "br",
      "strong",
      "b",
      "em",
      "i",
      "ul",
      "ol",
      "li",
      "h2",
      "h3",
      "h4",
      "blockquote",
    ],
    ALLOWED_ATTR: [],
  }),
);
</script>
<template><div class="rich-description" v-html="markup"></div></template>
