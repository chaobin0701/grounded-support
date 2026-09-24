<script setup lang="ts">
import { ArrowUpRight, Clock3, Database, FileText, MessageSquareText } from '@lucide/vue';
import AdminPageHeader from './ui/AdminPageHeader.vue';

const props = defineProps<{ displayName: string; documentCount: number; conversationCount: number }>();
</script>

<template>
  <section class="mx-auto max-w-[1400px]">
    <AdminPageHeader eyebrow="工作台" :title="`上午好，${displayName}`" description="这里汇总知识库、问答与处理任务的最新状态。">
      <template #actions><RouterLink to="/admin/knowledge" class="ui-button ui-button-primary">管理知识库 <ArrowUpRight :size="16" /></RouterLink></template>
    </AdminPageHeader>
    <div class="grid border-b border-slate-200 md:grid-cols-4"><div v-for="metric in [{label:'知识库',value:'查看',note:'进入知识库查看实际状态',icon:Database},{label:'资料记录',value:String(props.documentCount),note:'当前载入的资料记录',icon:FileText},{label:'问答轨迹',value:String(props.conversationCount),note:'最近载入的轨迹记录',icon:MessageSquareText},{label:'服务连接',value:'已连接',note:'后台数据已成功载入',icon:Clock3}]" :key="metric.label" class="border-b border-slate-200 py-7 md:border-b-0 md:border-r md:px-7 first:pl-0 last:border-r-0"><component :is="metric.icon" :size="18" class="text-slate-400" /><strong class="mt-6 block text-3xl font-semibold tracking-tight">{{ metric.value }}</strong><span class="mt-1 block text-sm font-medium">{{ metric.label }}</span><small class="mt-2 block text-xs text-slate-400">{{ metric.note }}</small></div></div>
    <div class="mt-10 grid gap-10 xl:grid-cols-[1.25fr_.75fr]"><section><div class="mb-4 flex items-center justify-between"><h2 class="text-base font-semibold">最近动态</h2><RouterLink to="/admin/audit" class="text-xs text-brand-600">查看操作记录 <ArrowUpRight :size="14" /></RouterLink></div><div class="border-y border-slate-200 py-12 text-center"><p class="text-sm font-medium text-slate-600">暂未接入动态数据</p><p class="mt-2 text-xs text-slate-400">实际管理员操作可在“操作记录”中查看。</p></div></section><aside><h2 class="mb-4 text-base font-semibold">常用入口</h2><div class="divide-y divide-slate-200 border-y border-slate-200"><RouterLink to="/admin/knowledge" class="flex items-center justify-between py-4 text-sm font-medium text-slate-700 hover:text-brand-600">管理知识库 <ArrowUpRight :size="16" /></RouterLink><RouterLink to="/admin/conversations" class="flex items-center justify-between py-4 text-sm font-medium text-slate-700 hover:text-brand-600">查看对话轨迹 <ArrowUpRight :size="16" /></RouterLink><RouterLink to="/admin/audit" class="flex items-center justify-between py-4 text-sm font-medium text-slate-700 hover:text-brand-600">查看操作记录 <ArrowUpRight :size="16" /></RouterLink></div></aside></div>
  </section>
</template>
