<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ImageOff } from "@lucide/vue";
import { safeUrl } from "../catalog";
const props = defineProps<{
  src: string | null;
  alt: string;
  eager?: boolean;
}>();
const failed = ref(false);
const source = computed(() => safeUrl(props.src));
watch(
  () => props.src,
  () => {
    failed.value = false;
  },
);
</script>

<template>
  <div class="product-image">
    <img
      v-if="source && !failed"
      :src="source"
      :alt="alt"
      :loading="eager ? 'eager' : 'lazy'"
      decoding="async"
      width="640"
      height="640"
      @error="failed = true"
    />
    <div
      v-else
      class="image-placeholder"
      role="img"
      :aria-label="`${alt}，图片暂不可用`"
    >
      <ImageOff :size="26" /><span>图片暂不可用</span>
    </div>
  </div>
</template>
