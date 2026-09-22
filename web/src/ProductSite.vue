<script setup lang="ts">
import { ArrowRight, BookOpen, CheckCircle2, Database, FileSearch, Menu, MessageSquareText, ShieldCheck, Sparkles } from '@lucide/vue';

const steps = [
  { icon: Database, index: '01', title: '上传业务资料', text: '导入 Markdown、Word、PDF 与 FAQ，保留原始结构和出处。' },
  { icon: FileSearch, index: '02', title: '构建可验证索引', text: '选择分段方式和检索策略，在发布前预览每一个分段。' },
  { icon: MessageSquareText, index: '03', title: '让回答有据可依', text: '每轮对话重新检索，只回答资料明确支持的内容。' },
];
</script>

<template>
  <div class="min-h-screen bg-white text-slate-950">
    <header class="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur">
      <nav class="mx-auto flex h-16 max-w-7xl items-center justify-between px-6 lg:px-10">
        <RouterLink to="/product" class="flex items-center gap-3 font-semibold"><span class="grid size-9 place-items-center rounded-xl bg-brand-600 text-sm text-white">暖</span><span>暖巢智能客服</span></RouterLink>
        <div class="hidden items-center gap-8 text-sm text-slate-600 md:flex"><a href="#workflow" class="hover:text-slate-950">工作方式</a><RouterLink to="/help" class="hover:text-slate-950">帮助中心</RouterLink><RouterLink to="/admin/knowledge" class="hover:text-slate-950">管理后台</RouterLink></div>
        <RouterLink to="/" class="ui-button ui-button-primary">立即体验 <ArrowRight :size="16" /></RouterLink>
      </nav>
    </header>

    <main>
      <section class="relative overflow-hidden border-b border-slate-200">
        <div class="mx-auto grid min-h-[calc(100svh-4rem)] max-w-7xl items-center gap-16 px-6 py-20 lg:grid-cols-[.82fr_1.18fr] lg:px-10">
          <div class="relative z-10 max-w-xl animate-[fade-up_.65s_ease-out]">
            <p class="mb-6 inline-flex items-center gap-2 text-sm font-medium text-brand-600"><Sparkles :size="16" /> 面向电商服务团队的知识型 AI</p>
            <h1 class="text-5xl font-semibold leading-[1.08] tracking-[-.055em] text-slate-950 sm:text-6xl">让每一次回答，<br />都有据可依。</h1>
            <p class="mt-7 max-w-lg text-lg leading-8 text-slate-600">将散落的政策、手册与常见问题变成可检索的知识，让 AI 准确回答，也知道什么时候应该拒答。</p>
            <div class="mt-9 flex flex-wrap gap-3"><RouterLink to="/" class="ui-button ui-button-primary h-12 px-6">开始对话 <ArrowRight :size="17" /></RouterLink><RouterLink to="/help" class="ui-button h-12 px-6"><BookOpen :size="17" /> 查看帮助中心</RouterLink></div>
            <div class="mt-10 flex flex-wrap gap-5 text-xs text-slate-500"><span class="flex items-center gap-1.5"><CheckCircle2 :size="15" class="text-emerald-500" /> 资料边界回答</span><span class="flex items-center gap-1.5"><CheckCircle2 :size="15" class="text-emerald-500" /> 可追踪工具调用</span><span class="flex items-center gap-1.5"><CheckCircle2 :size="15" class="text-emerald-500" /> 管理权限隔离</span></div>
          </div>

          <div class="relative lg:translate-x-8">
            <div class="absolute -inset-20 -z-10 bg-[radial-gradient(circle_at_center,#dbe8ff_0,transparent_64%)]"></div>
            <div class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_30px_90px_-35px_rgba(15,23,42,.35)]">
              <div class="flex h-12 items-center justify-between border-b border-slate-100 px-5"><div class="flex gap-1.5"><i class="size-2.5 rounded-full bg-slate-200"></i><i class="size-2.5 rounded-full bg-slate-200"></i><i class="size-2.5 rounded-full bg-slate-200"></i></div><span class="text-xs text-slate-400">暖巢 · 知识工作台</span><Menu :size="16" class="text-slate-400" /></div>
              <div class="grid min-h-[480px] grid-cols-[150px_1fr]">
                <aside class="border-r border-slate-100 bg-slate-50 p-4"><strong class="text-xs text-slate-800">知识库</strong><div class="mt-5 space-y-2"><span class="block rounded-lg bg-brand-50 px-3 py-2 text-xs font-medium text-brand-700">售后服务</span><span class="block px-3 py-2 text-xs text-slate-500">产品手册</span><span class="block px-3 py-2 text-xs text-slate-500">物流政策</span></div></aside>
                <div class="p-6"><div class="flex items-start justify-between"><div><p class="text-xs text-slate-400">当前知识库</p><h2 class="mt-1 font-semibold">售后服务知识库</h2></div><span class="ui-badge bg-emerald-50 text-emerald-700">● 已启用</span></div><div class="mt-7 grid grid-cols-3 gap-4 border-y border-slate-100 py-5"><div><b class="text-xl">128</b><small class="block text-xs text-slate-400">份文档</small></div><div><b class="text-xl">2,480</b><small class="block text-xs text-slate-400">个分段</small></div><div><b class="text-xl">94%</b><small class="block text-xs text-slate-400">检索命中</small></div></div><div class="mt-6 space-y-3"><div v-for="name in ['退换货政策.md','产品保修手册.pdf','物流与配送.docx']" :key="name" class="flex items-center justify-between rounded-lg border border-slate-100 px-4 py-3 text-sm"><span>{{ name }}</span><span class="text-xs text-emerald-600">已索引</span></div></div></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="workflow" class="mx-auto max-w-7xl px-6 py-28 lg:px-10">
        <div class="max-w-2xl"><p class="text-sm font-semibold text-brand-600">从资料到答案</p><h2 class="mt-4 text-4xl font-semibold tracking-[-.04em]">一条清楚、可检查的知识流水线</h2><p class="mt-4 text-slate-600">管理员知道资料如何被处理，客服知道答案来自哪里，访客只看到需要的信息。</p></div>
        <div class="mt-16 grid border-y border-slate-200 md:grid-cols-3"><article v-for="step in steps" :key="step.index" class="group border-b border-slate-200 py-10 md:border-b-0 md:border-r md:px-9 first:pl-0 last:border-r-0"><component :is="step.icon" :size="24" class="text-brand-600" /><small class="mt-12 block text-xs text-slate-400">{{ step.index }}</small><h3 class="mt-3 text-lg font-semibold">{{ step.title }}</h3><p class="mt-3 text-sm leading-7 text-slate-500">{{ step.text }}</p></article></div>
      </section>

      <section class="bg-slate-950 px-6 py-24 text-white"><div class="mx-auto flex max-w-7xl flex-col items-start justify-between gap-10 lg:flex-row lg:items-end"><div><ShieldCheck :size="28" class="text-brand-500" /><h2 class="mt-6 max-w-2xl text-4xl font-semibold tracking-[-.04em]">当资料没有答案时，系统明确说不知道。</h2><p class="mt-5 text-slate-400">拒绝编造，是可信客服的第一条规则。</p></div><RouterLink to="/" class="ui-button h-12 border-white bg-white px-6 text-slate-950 hover:bg-slate-100">体验智能客服 <ArrowRight :size="17" /></RouterLink></div></section>
    </main>
    <footer class="border-t border-slate-200 px-6 py-8"><div class="mx-auto flex max-w-7xl justify-between text-xs text-slate-400"><span>© 2026 暖巢智能客服</span><div class="flex gap-5"><RouterLink to="/help">帮助中心</RouterLink><RouterLink to="/admin">管理后台</RouterLink></div></div></footer>
  </div>
</template>

<style scoped>@keyframes fade-up { from { opacity:0; transform:translateY(18px) } }</style>
