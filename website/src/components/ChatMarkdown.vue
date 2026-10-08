<script setup lang="ts">
import { computed } from "vue";
import DOMPurify from "dompurify";
import { parseMarkdown } from "../chat/markdown";
const props = defineProps<{ text: string }>();
const markup = computed(() =>
  DOMPurify.sanitize(parseMarkdown(props.text), {
    ALLOWED_TAGS: [
      "p",
      "br",
      "strong",
      "em",
      "del",
      "ul",
      "ol",
      "li",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "blockquote",
      "pre",
      "code",
      "hr",
      "div",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "a",
    ],
    ALLOWED_ATTR: ["href", "target", "rel", "class", "start"],
  }),
);
</script>
<template><div class="chat-markdown" v-html="markup"></div></template>
