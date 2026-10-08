<script setup lang="ts">
import { computed } from "vue";
import { Check, LoaderCircle, Search, Sparkles } from "@lucide/vue";
import { progressSteps, duration } from "../chat/progress";
import type { ProgressEvent } from "../chat/types";
const props = defineProps<{ events: ProgressEvent[]; settled?: boolean }>();
const steps = computed(() => progressSteps(props.events, props.settled));
</script>
<template>
  <details v-if="steps.length" class="chat-process">
    <summary>
      <Sparkles :size="14" /><span>查看处理过程</span
      ><small>{{ steps.length }} 步</small>
    </summary>
    <ol>
      <li v-for="step in steps" :key="step.key">
        <LoaderCircle
          v-if="step.status === 'running' && !settled"
          :size="15"
          class="spinner"
        />
        <Check v-else-if="step.status === 'completed'" :size="15" />
        <Search v-else :size="15" />
        <div>
          <small>{{ step.label }}</small>
          <p>{{ step.text }}</p>
        </div>
        <span
          >{{ step.stateLabel
          }}<small v-if="step.resultCount !== undefined"
            >{{ step.resultCount }} 条</small
          ><small v-if="duration(step.durationMs)">{{
            duration(step.durationMs)
          }}</small></span
        >
      </li>
    </ol>
  </details>
</template>
