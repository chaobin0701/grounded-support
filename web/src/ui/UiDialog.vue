<script setup lang="ts">
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui';
import { X } from '@lucide/vue';

defineProps<{ open: boolean; title: string; description?: string; size?: 'sm' | 'md' | 'lg' }>();
const emit = defineEmits<{ 'update:open': [value: boolean] }>();
</script>

<template>
  <DialogRoot :open="open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-[2px] data-[state=open]:animate-in" />
      <DialogContent class="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-2xl border border-slate-200 bg-white shadow-2xl" :class="size === 'lg' ? 'max-w-4xl' : size === 'sm' ? 'max-w-md' : 'max-w-xl'">
        <header class="flex items-start justify-between border-b border-slate-100 px-6 py-5">
          <div>
            <DialogTitle class="text-lg font-semibold text-slate-900">{{ title }}</DialogTitle>
            <DialogDescription v-if="description" class="mt-1 text-sm leading-6 text-slate-500">{{ description }}</DialogDescription>
          </div>
          <DialogClose class="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="关闭"><X :size="18" /></DialogClose>
        </header>
        <div class="px-6 py-5"><slot /></div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
