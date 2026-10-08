<script setup lang="ts" generic="T extends string | number">
import { computed } from 'vue';
import { Check } from '@lucide/vue';
import { updateChoiceSelection, type ChoiceOption } from './choice-list';

const props = withDefaults(defineProps<{
  title: string;
  options: readonly ChoiceOption<T>[];
  modelValue: readonly T[];
  disabled?: boolean;
  readonly?: boolean;
  bulk?: boolean;
}>(), { bulk: true });
const emit = defineEmits<{ 'update:modelValue': [value: T[]] }>();
const selectedCount = computed(() => props.options.filter(option => props.modelValue.includes(option.value)).length);
const editable = computed(() => props.options.filter(option => !option.disabled));
const allSelected = computed(() => editable.value.length > 0 && editable.value.every(option => props.modelValue.includes(option.value)));
function update(options: readonly ChoiceOption<T>[], checked: boolean) {
  if (props.disabled || props.readonly) return;
  emit('update:modelValue', updateChoiceSelection(props.modelValue, options, checked));
}
</script>

<template>
  <fieldset class="ui-choice-list" :class="{ 'is-readonly-list': readonly }" :disabled="disabled">
    <legend>{{ title }}</legend>
    <div class="ui-choice-heading">
      <span>{{ readonly ? options.length + ' 项' : selectedCount + ' / ' + options.length + ' 已选' }}</span>
      <button v-if="bulk && !readonly && editable.length" type="button" :disabled="disabled" @click="update(options, !allSelected)">{{ allSelected ? '取消选择' : '选择全部' }}</button>
    </div>
    <template v-if="readonly">
      <div v-for="option in options" :key="option.value" class="ui-choice-item is-readonly"><Check :size="14" aria-hidden="true" /><span><strong>{{ option.label }}</strong><small v-if="option.detail">{{ option.detail }}</small></span></div>
    </template>
    <template v-else>
      <label v-for="option in options" :key="option.value" class="ui-choice-item" :class="{ 'is-locked': option.disabled }">
        <input type="checkbox" :checked="modelValue.includes(option.value)" :disabled="disabled || option.disabled" @change="update([option], ($event.target as HTMLInputElement).checked)" />
        <span><strong>{{ option.label }}</strong><small v-if="option.detail">{{ option.detail }}</small></span>
        <span v-if="option.disabled" class="ui-choice-lock">不可分配</span>
      </label>
    </template>
    <p v-if="!options.length" class="ui-choice-empty">暂无可选项</p>
  </fieldset>
</template>

<style scoped>
.ui-choice-list { min-width: 0; margin: 0; padding: 12px 14px; border: 1px solid #e5e9f0; border-radius: 8px; background: #fff; }
.ui-choice-list legend { padding: 0 5px; color: #344054; font-size: 12px; font-weight: 600; }
.ui-choice-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; color: #98a2b3; font-size: 11px; }
.ui-choice-heading button { padding: 3px 0; border: 0; background: none; color: #2457e6; font: inherit; cursor: pointer; }
.ui-choice-heading button:disabled { opacity: .5; cursor: not-allowed; }
.ui-choice-item { display: flex; align-items: flex-start; gap: 9px; min-width: 0; min-height: 44px; padding: 8px 0; font-weight: 400; box-sizing: border-box; cursor: pointer; }
.ui-choice-item + .ui-choice-item { border-top: 1px solid #f1f3f6; }
.ui-choice-item input { flex: none; width: 16px; height: 16px; margin: 2px 0 0; accent-color: #2457e6; }
.ui-choice-item > span:first-of-type { min-width: 0; flex: 1; }
.ui-choice-item strong { display: block; font-size: 12px; font-weight: 500; line-height: 1.7; color: #344054; overflow-wrap: anywhere; }
.ui-choice-item small { display: block; margin-top: 2px; color: #98a2b3; font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
.ui-choice-item.is-locked { cursor: default; }
.ui-choice-item.is-locked strong { color: #98a2b3; }
.ui-choice-lock { flex: none; color: #98a2b3; font-size: 10px; line-height: 2; }
.ui-choice-item.is-readonly { cursor: default; }
.ui-choice-item.is-readonly svg { flex: none; margin-top: 4px; color: #7b8eaa; }
.ui-choice-list.is-readonly-list { padding: 0; border: 0; background: transparent; }
.is-readonly-list legend { padding: 0; }
.is-readonly-list .ui-choice-heading { margin-top: 4px; margin-bottom: 2px; }
.ui-choice-empty { margin: 8px 0; color: #98a2b3; font-size: 12px; }
.ui-choice-heading button:focus-visible,.ui-choice-item input:focus-visible { outline: 2px solid #2457e6; outline-offset: 3px; border-radius: 3px; }
@media (max-width: 520px) { .ui-choice-heading button { min-height: 36px; }.ui-choice-list { padding: 10px 12px; } }
</style>
