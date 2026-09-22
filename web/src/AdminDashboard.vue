<script setup lang="ts">
import { ArrowUpRight, BookOpen, Bot, CheckCircle2, Clock3, Database, FileText, MessageSquareText } from '@lucide/vue';

const props = defineProps<{ displayName: string; documentCount: number; conversationCount: number }>();
const activities = [
  { title: '售后服务知识库完成索引', meta: '128 份文档 · 混合检索', time: '12 分钟前', ok: true },
  { title: '产品手册新增 3 份资料', meta: '正在解析与分段', time: '34 分钟前', ok: false },
  { title: '访客问答触发安全拒答', meta: '没有找到明确支持的资料', time: '1 小时前', ok: true },
];
</script>

<template>
  <section class="mx-auto max-w-[1400px]">
    <header class="flex flex-wrap items-end justify-between gap-5 border-b border-slate-200 pb-7"><div><p class="text-xs font-semibold text-brand-600">工作台</p><h1 class="mt-2 text-3xl font-semibold tracking-[-.035em]">上午好，{{ displayName }}</h1><p class="mt-2 text-sm text-slate-500">这里汇总知识库、问答与处理任务的最新状态。</p></div><RouterLink to="/admin/knowledge" class="ui-button ui-button-primary">管理知识库 <ArrowUpRight :size="16" /></RouterLink></header>
    <div class="grid border-b border-slate-200 md:grid-cols-4"><div v-for="metric in [{label:'知识库',value:'已接入',note:'支持多知识库',icon:Database},{label:'最近资料',value:String(props.documentCount),note:'当前加载范围',icon:FileText},{label:'最近问答',value:String(props.conversationCount),note:'最近 50 次轨迹',icon:MessageSquareText},{label:'服务状态',value:'正常',note:'API 与数据库在线',icon:Clock3}]" :key="metric.label" class="border-b border-slate-200 py-7 md:border-b-0 md:border-r md:px-7 first:pl-0 last:border-r-0"><component :is="metric.icon" :size="18" class="text-slate-400" /><strong class="mt-6 block text-3xl font-semibold tracking-tight">{{ metric.value }}</strong><span class="mt-1 block text-sm font-medium">{{ metric.label }}</span><small class="mt-2 block text-xs text-slate-400">{{ metric.note }}</small></div></div>
    <div class="mt-10 grid gap-10 xl:grid-cols-[1.25fr_.75fr]"><section><div class="mb-4 flex items-center justify-between"><h2 class="text-base font-semibold">最近动态</h2><span class="text-xs text-slate-400">实时更新</span></div><div class="divide-y divide-slate-200 border-y border-slate-200"><article v-for="item in activities" :key="item.title" class="flex items-center gap-4 py-5"><span class="grid size-9 place-items-center rounded-lg" :class="item.ok ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'"><CheckCircle2 v-if="item.ok" :size="18" /><Clock3 v-else :size="18" /></span><div class="min-w-0 flex-1"><strong class="text-sm font-medium">{{ item.title }}</strong><p class="mt-1 text-xs text-slate-500">{{ item.meta }}</p></div><time class="text-xs text-slate-400">{{ item.time }}</time></article></div></section><aside><h2 class="mb-4 text-base font-semibold">下一步</h2><div class="space-y-3"><RouterLink to="/admin/knowledge" class="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 hover:border-brand-200 hover:bg-brand-50/30"><BookOpen class="text-brand-600" :size="20" /><span class="flex-1"><strong class="block text-sm">完善售后知识库</strong><small class="mt-1 block text-xs text-slate-500">还有 2 份资料等待处理</small></span><ArrowUpRight :size="16" class="text-slate-400" /></RouterLink><RouterLink to="/admin/conversations" class="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 hover:border-brand-200 hover:bg-brand-50/30"><Bot class="text-brand-600" :size="20" /><span class="flex-1"><strong class="block text-sm">检查拒答记录</strong><small class="mt-1 block text-xs text-slate-500">确认是否需要补充资料</small></span><ArrowUpRight :size="16" class="text-slate-400" /></RouterLink></div></aside></div>
  </section>
</template>
