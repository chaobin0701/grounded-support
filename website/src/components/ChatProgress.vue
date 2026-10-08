<script setup lang="ts">
import { computed } from "vue";
import { ChevronDown, CircleAlert, LoaderCircle, Wrench } from "@lucide/vue";
import { commentaryLines, progressSteps, toolLabel } from "../chat/progress";
import type { ProcessEvent } from "../chat/types";
const props = defineProps<{ events: ProcessEvent[]; settled?: boolean }>();
const steps = computed(() => progressSteps(props.events, props.settled));
const commentary = computed(() => commentaryLines(props.events));
</script>
<template>
  <details v-if="steps.length" class="chat-process" :open="!settled">
    <summary>
      <ChevronDown class="chat-process-chevron" :size="14" aria-hidden="true" /><span>{{ settled ? '查看处理过程' : '正在处理' }}</span
      ><small>{{ steps.length }} 步</small>
    </summary>
    <p v-for="line in settled ? commentary : []" :key="line.id" class="chat-commentary">{{ line.text }}</p>
    <ol>
      <li v-for="step in steps" :key="step.key" :aria-label="`${toolLabel(step.text)}，${step.stateLabel}`">
        <LoaderCircle
          v-if="step.status === 'running' && !settled"
          :size="15"
          class="spinner"
          aria-hidden="true"
        />
        <Wrench v-else-if="step.status === 'completed'" :size="15" aria-hidden="true" />
        <CircleAlert v-else :size="15" aria-hidden="true" />
        <span>{{ toolLabel(step.text) }}</span>
        <small v-if="step.stateLabel === '未完成'">未完成</small>
      </li>
    </ol>
  </details>
</template>
