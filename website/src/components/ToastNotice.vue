<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { CheckCircle2 } from "@lucide/vue";
import { chat } from "../chat/service";
const visible = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => chat.state.notice,
  (text) => {
    clearTimeout(timer);
    visible.value = !!text;
    if (text)
      timer = setTimeout(() => {
        visible.value = false;
        chat.state.notice = "";
      }, 3000);
  },
);
onBeforeUnmount(() => clearTimeout(timer));
</script>
<template>
  <Teleport to="body"
    ><Transition name="assistant-window"
      ><div v-if="visible" class="toast-notice" role="status">
        <CheckCircle2 :size="18" /><span>{{ chat.state.notice }}</span>
      </div></Transition
    ></Teleport
  >
</template>
