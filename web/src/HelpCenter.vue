<script setup lang="ts">
import { ArrowRight, BookOpen, Bot, Boxes, ChevronRight, CircleHelp, KeyRound, MessageSquareText, Search, ShieldCheck } from '@lucide/vue';
import { computed, ref } from 'vue';
import UiDialog from './ui/UiDialog.vue';

const query = ref('');
const activeCategory = ref('all');
const categories = [
  { id: 'start', label: '快速开始', icon: BookOpen }, { id: 'knowledge', label: '知识库', icon: Boxes },
  { id: 'chat', label: '对话与引用', icon: MessageSquareText }, { id: 'access', label: '管理员与权限', icon: KeyRound },
];
const articles = [
  { category: 'start', title: '第一次创建知识库', text: '从资料上传、分段配置到发布第一个索引版本。', time: '5 分钟', body: ['进入管理后台的“知识库”，点击“新建知识库”。', '输入名称后，系统会自动进入多文件导入。', '确认分段和检索设置，构建版本并在检索验证后启用。'] },
  { category: 'knowledge', title: '选择通用分段还是父子分段', text: '了解两种模式的区别和适用内容。', time: '7 分钟', body: ['通用分段适合短文档、FAQ 和结构简单的政策。', '父子分段使用较小子块召回、较大父块作为证据，适合长手册。', '可以在发布前通过分段预览检查效果。'] },
  { category: 'knowledge', title: '经济与高质量索引', text: '全文、向量和混合检索的配置建议。', time: '6 分钟', body: ['经济索引只使用全文检索，不产生 Embedding 成本。', '高质量索引支持向量与混合检索，需要配置 Embedding 模型。', '业务政策通常优先使用混合检索，再通过评测调整阈值。'] },
  { category: 'chat', title: '为什么系统会拒绝回答', text: '资料边界、引用校验和安全拒答机制。', time: '4 分钟', body: ['当前资料没有明确支持的结论时，系统会拒绝推测。', '模型给出的引用必须来自本轮真实检索结果。', '管理员可以通过对话轨迹判断是否需要补充资料。'] },
  { category: 'chat', title: '查看一次回答的执行过程', text: '理解工具调用、知识检索和最终回答。', time: '5 分钟', body: ['访客端只展示可公开的过程摘要。', '管理员可以查看工具参数、耗时、Token 和最终输出。', '密钥、完整系统提示词等敏感信息不应出现在公开过程里。'] },
  { category: 'access', title: '配置管理员角色与权限', text: '创建角色并按照职责授予最小权限。', time: '8 分钟', body: ['先创建符合实际职责的角色。', '只授予完成工作所需的最小权限。', '权限变更和关键资料操作都会写入审计记录。'] },
  { category: 'access', title: '管理员安全指南', text: '了解密钥、权限、审计和生产部署建议。', time: '6 分钟', body: ['模型和 Embedding 密钥只通过部署环境变量提供，不写入前端或数据库。', '管理员按角色授予最小权限，停用账号后立即阻止新的访问。', '生产环境需要保留审计记录，并定期检查失败调用与异常资料操作。'] },
];
const selectedArticle = ref<(typeof articles)[number] | null>(null);
const filtered = computed(() => { const value = query.value.trim().toLowerCase(); return articles.filter(item =>
  (activeCategory.value === 'all' || item.category === activeCategory.value)
  && (!value || `${item.title}${item.text}`.toLowerCase().includes(value)),
); });
</script>

<template>
  <div class="min-h-screen bg-white text-slate-900">
    <header class="border-b border-slate-200"><nav class="mx-auto flex h-16 max-w-7xl items-center justify-between px-6 lg:px-10"><RouterLink to="/product" class="flex items-center gap-3 font-semibold"><span class="grid size-9 place-items-center rounded-xl bg-brand-600 text-white">暖</span>暖巢帮助中心</RouterLink><div class="flex items-center gap-3"><RouterLink to="/" class="ui-button">进入客服</RouterLink><RouterLink to="/admin" class="ui-button ui-button-primary">管理后台</RouterLink></div></nav></header>
    <section class="border-b border-slate-200 bg-slate-50"><div class="mx-auto max-w-4xl px-6 py-20 text-center"><p class="text-sm font-semibold text-brand-600">产品文档与使用指南</p><h1 class="mt-4 text-4xl font-semibold tracking-[-.04em]">你好，需要什么帮助？</h1><div class="relative mx-auto mt-9 max-w-2xl"><Search class="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" :size="20" /><input v-model="query" class="h-14 w-full rounded-xl border border-slate-200 bg-white pl-12 pr-4 text-base shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-100" placeholder="搜索知识库、索引、权限或对话…" /></div></div></section>
    <main class="mx-auto grid max-w-7xl gap-12 px-6 py-14 lg:grid-cols-[220px_1fr] lg:px-10">
      <aside><p class="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">文档分类</p><nav class="space-y-1"><button class="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm" :class="activeCategory === 'all' ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'" @click="activeCategory = 'all'">全部文档</button><button v-for="category in categories" :key="category.id" class="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm" :class="activeCategory === category.id ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'" @click="activeCategory = category.id"><component :is="category.icon" :size="17" />{{ category.label }}</button></nav><div class="mt-8 border-t border-slate-200 pt-6"><p class="text-sm font-medium">还是没有解决？</p><p class="mt-2 text-xs leading-6 text-slate-500">在演示客服中描述你的问题。</p><RouterLink to="/" class="mt-4 inline-flex items-center gap-2 text-sm font-medium text-brand-600">联系智能客服 <ArrowRight :size="15" /></RouterLink></div></aside>
      <section><div class="flex items-end justify-between border-b border-slate-200 pb-5"><div><h2 class="text-2xl font-semibold">{{ query ? '搜索结果' : activeCategory === 'all' ? '常用指南' : categories.find(item => item.id === activeCategory)?.label }}</h2><p class="mt-2 text-sm text-slate-500">{{ filtered.length }} 篇文档</p></div><Bot :size="24" class="text-brand-500" /></div><div class="divide-y divide-slate-200"><button v-for="article in filtered" :key="article.title" class="group flex w-full items-center gap-5 py-6 text-left" @click="selectedArticle = article"><div class="grid size-10 flex-none place-items-center rounded-lg bg-brand-50 text-brand-600"><CircleHelp :size="19" /></div><div class="min-w-0 flex-1"><h3 class="font-medium group-hover:text-brand-600">{{ article.title }}</h3><p class="mt-1 text-sm text-slate-500">{{ article.text }}</p></div><span class="hidden text-xs text-slate-400 sm:block">{{ article.time }}</span><ChevronRight :size="17" class="text-slate-300 group-hover:text-brand-500" /></button><p v-if="!filtered.length" class="py-16 text-center text-sm text-slate-500">没有找到相关文档，请尝试其他关键词。</p></div>
        <button class="mt-14 flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-6 py-5 text-left hover:border-brand-200 hover:bg-brand-50/40" @click="selectedArticle = articles.find(item => item.title === '管理员安全指南') || null"><div class="flex items-center gap-4"><ShieldCheck class="text-brand-600" :size="22" /><div><strong class="text-sm">管理员安全指南</strong><p class="mt-1 text-xs text-slate-500">了解密钥、权限、审计和生产部署建议。</p></div></div><ArrowRight :size="18" class="text-slate-400" /></button>
      </section>
    </main>
    <UiDialog :open="selectedArticle !== null" :title="selectedArticle?.title || ''" :description="selectedArticle?.text" @update:open="selectedArticle = $event ? selectedArticle : null"><ol class="space-y-4"><li v-for="(paragraph, index) in selectedArticle?.body || []" :key="paragraph" class="flex gap-3 text-sm leading-7 text-slate-600"><span class="grid size-6 flex-none place-items-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">{{ index + 1 }}</span><span>{{ paragraph }}</span></li></ol><div class="mt-6 border-t border-slate-100 pt-5 text-xs text-slate-400">预计阅读 {{ selectedArticle?.time }}</div></UiDialog>
  </div>
</template>
