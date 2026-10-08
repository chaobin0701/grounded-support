<script setup lang="ts">
import { computed } from 'vue';
import { ChevronDown, CircleAlert, LoaderCircle, Wrench } from '@lucide/vue';
import type { CommentaryEvent, ProgressEvent } from '../chat-api';

const props = withDefaults(defineProps<{
  steps: (ProgressEvent & { key: string })[];
  commentary?: CommentaryEvent[];
  settled?: boolean;
}>(), { commentary: () => [], settled: false });
const toolSteps = computed(() => props.steps.filter(step => step.stage === 'tool'));
function toolLabel(text: string) {
  return text.replace(/^(?:正在|已)(?=查看|读取|检索|查询|加载|调用)/u, '').replace(/[.…]+$/u, '');
}
function stateLabel(step: ProgressEvent) {
  return step.status === 'completed' ? '已完成' : props.settled ? '未完成' : '进行中';
}
</script>

<template>
  <details v-if="toolSteps.length" class="process-collapsible message-process" :open="!settled">
    <summary>
      <ChevronDown class="process-chevron" :size="14" aria-hidden="true" />
      <span class="process-summary-label">{{ settled ? '查看处理过程' : '正在处理' }}</span>
      <small>{{ toolSteps.length }} 步</small>
    </summary>
    <div class="process-content">
      <p v-for="line in commentary" :key="line.id" class="public-commentary">{{ line.text }}</p>
      <ol>
        <li v-for="step in toolSteps" :key="step.key" class="process-step" :aria-label="`${toolLabel(step.text)}，${stateLabel(step)}`">
          <Wrench v-if="step.status === 'completed'" :size="15" aria-hidden="true" />
          <LoaderCircle v-else-if="!settled" :size="15" class="spinning" aria-hidden="true" />
          <CircleAlert v-else :size="15" aria-hidden="true" />
          <span>{{ toolLabel(step.text) }}</span>
          <small v-if="stateLabel(step) === '未完成'">未完成</small>
        </li>
      </ol>
    </div>
  </details>
</template>
