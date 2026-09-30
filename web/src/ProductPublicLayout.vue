<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Bot, MessageCircle, X } from '@lucide/vue';
import ChatWorkspace from './ChatWorkspace.vue';

const route = useRoute();
const chatOpen = ref(false);
const chatWorkspace = ref<InstanceType<typeof ChatWorkspace> | null>(null);

function startWidgetConversation() { chatWorkspace.value?.newConversation(); }
watch(() => route.path, () => { chatOpen.value = false; });
</script>

<template>
  <div class="min-h-screen bg-[#fbfcfa] text-[#17211e]">
    <header class="sticky top-0 z-40 border-b border-[#e3e8e3]/90 bg-[#fbfcfa]/95 backdrop-blur">
      <nav class="mx-auto flex h-[72px] max-w-[1240px] items-center justify-between px-6 lg:px-10">
        <RouterLink to="/product" class="flex items-center gap-3 text-[15px] font-semibold tracking-[-.02em]"><span class="grid size-10 place-items-center rounded-[13px] bg-[#2457e6] text-lg text-white">暖</span><span>暖巢智能</span></RouterLink>
        <div class="hidden items-center gap-7 text-sm text-[#68756f] md:flex"><RouterLink to="/product" class="transition hover:text-[#17211e]">首页</RouterLink><RouterLink to="/product/about" class="transition hover:text-[#17211e]">关于我们</RouterLink><RouterLink to="/product/products" class="transition hover:text-[#17211e]">产品</RouterLink><RouterLink to="/product/support" class="transition hover:text-[#17211e]">服务支持</RouterLink><RouterLink to="/product/news" class="transition hover:text-[#17211e]">品牌动态</RouterLink></div>
        <button type="button" class="inline-flex h-10 items-center gap-2 rounded-lg bg-[#2457e6] px-4 text-sm font-semibold text-white transition hover:bg-[#1d48c5]" @click="chatOpen = true">咨询 AI 助手 <MessageCircle :size="16" /></button>
      </nav>
    </header>

    <slot />

    <footer class="border-t border-[#dfe6df] px-6 py-8"><div class="mx-auto flex max-w-[1240px] flex-col gap-4 text-xs text-[#8c9891] sm:flex-row sm:items-center sm:justify-between"><span>© 2026 暖巢智能 · 企业产品与服务平台</span><div class="flex flex-wrap gap-5"><RouterLink to="/product/about">关于我们</RouterLink><RouterLink to="/product/products">产品</RouterLink><RouterLink to="/product/support">服务支持</RouterLink><RouterLink to="/product/news">品牌动态</RouterLink></div></div></footer>
    <button type="button" aria-label="打开 AI 助手" class="fixed bottom-6 right-6 z-50 grid size-14 place-items-center rounded-full bg-[#2457e6] text-white shadow-[0_12px_30px_-10px_rgba(36,87,230,.8)] transition hover:-translate-y-1 hover:bg-[#1d48c5]" @click="chatOpen = true"><Bot :size="25" /></button>
    <Transition name="chat-drawer"><div v-if="chatOpen" class="fixed inset-0 z-[60]"><button type="button" aria-label="关闭聊天窗口" class="absolute inset-0 bg-[#17211e]/25 backdrop-blur-[2px]" @click="chatOpen = false" /><aside class="absolute bottom-4 right-4 flex h-[min(760px,calc(100vh-32px))] w-[min(440px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-[#dfe6df]"><header class="flex h-14 shrink-0 items-center justify-between border-b border-[#e8ece8] px-4"><div class="flex items-center gap-2"><span class="grid size-8 place-items-center rounded-lg bg-[#2457e6] text-sm text-white">暖</span><span class="text-sm font-semibold">暖巢 AI 助手</span></div><div class="flex items-center gap-1"><button type="button" class="rounded-lg px-2 py-1 text-xs font-semibold text-[#536b5d] hover:bg-[#f2f5f2] disabled:opacity-50" :disabled="!chatWorkspace || chatWorkspace.isSending" @click="startWidgetConversation">＋ 新建会话</button><RouterLink to="/product/assistant" class="rounded-lg px-2 py-1 text-xs font-semibold text-[#2457e6] hover:bg-[#f2f5ff]" @click="chatOpen = false">完整助手</RouterLink><button type="button" aria-label="关闭" class="grid size-8 place-items-center rounded-lg text-[#7c8982] hover:bg-[#f2f5f2]" @click="chatOpen = false"><X :size="18" /></button></div></header><ChatWorkspace ref="chatWorkspace" mode="widget" /></aside></div></Transition>
  </div>
</template>
