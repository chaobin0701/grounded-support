<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft, Check, Copy, Download } from '@lucide/vue';
import source from './docs/integration.md?raw';
import { renderIntegrationDocument } from './integration-document';
import { siteBrand } from './brand';
import BrandMark from './ui/BrandMark.vue';

const { html, sections } = renderIntegrationDocument(source);
const route = useRoute();
const router = useRouter();
const reader = ref<HTMLElement | null>(null);
const mobileContents = ref<HTMLDetailsElement | null>(null);
const activeId = ref(sections[0]?.id ?? '');
const notice = ref('');
const copied = ref(false);
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
const downloads = new Set<string>();

function notify(message: string) {
  clearTimeout(noticeTimer);
  notice.value = message;
  noticeTimer = setTimeout(() => { notice.value = ''; copied.value = false; }, 3000);
}
async function copyDocument() {
  try {
    await navigator.clipboard.writeText(source);
    copied.value = true;
    notify('接入文档已复制');
  } catch { notify('复制失败，请下载 Markdown 文档'); }
}
function downloadDocument() {
  const url = URL.createObjectURL(new Blob([source], { type: 'text/markdown;charset=utf-8' }));
  downloads.add(url);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'agent-integration.md';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(url); }, 10000);
}
function jump(id: string) {
  const heading = reader.value?.querySelector<HTMLElement>(`#${id}`);
  if (!heading) return;
  if (mobileContents.value) mobileContents.value.open = false;
  activeId.value = id;
  heading.scrollIntoView({ block: 'start' });
  void router.replace({ hash: `#${id}` });
}
function updateActive() {
  if (!reader.value) return;
  const threshold = reader.value.getBoundingClientRect().top + 110;
  let current = sections[0]?.id ?? '';
  for (const section of sections) {
    const heading = reader.value.querySelector(`#${section.id}`);
    if (heading && heading.getBoundingClientRect().top <= threshold) current = section.id;
  }
  activeId.value = current;
}
onMounted(() => { if (route.hash) jump(route.hash.slice(1)); });
onUnmounted(() => {
  clearTimeout(noticeTimer);
  for (const url of downloads) URL.revokeObjectURL(url);
});
</script>

<template>
  <div ref="reader" class="integration-docs" @scroll.passive="updateActive">
    <header class="docs-header">
      <div class="docs-header-inner">
        <RouterLink to="/docs/integration" class="docs-brand"><BrandMark /><span>{{ siteBrand.name }} <span class="docs-brand-divider">/</span> 开发文档</span></RouterLink>
        <div class="docs-actions">
          <button type="button" @click="copyDocument"><Check v-if="copied" :size="16" aria-hidden="true" /><Copy v-else :size="16" aria-hidden="true" />复制文档</button>
          <button type="button" @click="downloadDocument"><Download :size="16" aria-hidden="true" />下载 Markdown</button>
        </div>
      </div>
    </header>
    <div class="docs-layout">
      <aside class="docs-sidebar">
        <p class="docs-sidebar-label">接入指南</p>
        <nav aria-label="文档目录">
          <a v-for="section in sections" :key="section.id" :href="`#${section.id}`" :aria-current="activeId === section.id ? 'location' : undefined" @click.prevent="jump(section.id)">{{ section.title }}</a>
        </nav>
        <RouterLink to="/admin/integrations" class="docs-admin-link"><ArrowLeft :size="14" aria-hidden="true" />接入管理</RouterLink>
      </aside>
      <main class="docs-main">
        <details ref="mobileContents" class="docs-mobile-contents">
          <summary>文档目录</summary>
          <nav aria-label="移动端文档目录"><a v-for="section in sections" :key="section.id" :href="`#${section.id}`" @click.prevent="jump(section.id)">{{ section.title }}</a></nav>
        </details>
        <article class="docs-prose" aria-label="Agent 接入文档" v-html="html" />
        <footer class="docs-footer"><span>Agent API · v1</span><a href="#" @click.prevent="reader?.scrollTo({ top: 0 }); router.replace({ hash: '' })">返回顶部 ↑</a></footer>
      </main>
    </div>
    <div class="docs-notice" role="status" aria-live="polite" :class="{ visible: notice }">{{ notice }}</div>
  </div>
</template>

<style scoped>
.integration-docs { height: 100dvh; overflow-y: auto; background: #fff; color: #263247; font-size: 14px; overscroll-behavior: contain; }
.docs-header { position: sticky; top: 0; z-index: 5; background: #fffffffa; border-bottom: 1px solid #e8ecf2; }
.docs-header-inner { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 72px; width: min(1160px, 100%); margin: 0 auto; padding: 12px 28px; }
.docs-brand { display: flex; align-items: center; gap: 11px; color: #172033; font-weight: 600; text-decoration: none; }
.docs-brand :deep(.hexu-brand-mark) { width: 28px; height: 28px; border-radius: 7px; }
.docs-brand-divider { margin: 0 10px; color: #cad1de; font-weight: 400; }
.docs-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.docs-actions button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 36px; padding: 7px 11px; background: #fff; border: 1px solid #dde3ed; border-radius: 6px; color: #52617a; font-size: 12px; transition: border-color .15s, color .15s; }
.docs-actions button:hover { color: #2457e6; border-color: #8ca5ed; }
.integration-docs a:focus-visible,.integration-docs button:focus-visible,.integration-docs summary:focus-visible { outline: 2px solid #2457e6; outline-offset: 3px; }
.docs-layout { display: grid; grid-template-columns: 210px minmax(0, 1fr); align-items: start; gap: 50px; max-width: 1160px; margin: 0 auto; padding: 44px 28px 32px; }
.docs-sidebar { position: sticky; top: 104px; max-height: calc(100dvh - 128px); overflow-y: auto; padding-right: 10px; }
.docs-sidebar-label { margin: 0 0 16px; color: #172033; font-size: 12px; font-weight: 600; }
.docs-sidebar nav { display: grid; gap: 2px; }
.docs-sidebar nav a { padding: 8px 12px; border-left: 2px solid transparent; color: #69758a; text-decoration: none; font-size: 13px; line-height: 1.6; }
.docs-sidebar nav a:hover { color: #2457e6; }
.docs-sidebar nav a[aria-current] { border-color: #2457e6; color: #2457e6; background: #f5f8ff; }
.docs-admin-link { display: inline-flex; align-items: center; gap: 7px; margin-top: 25px; padding: 10px 0; border-top: 1px solid #e8ecf2; color: #69758a; font-size: 12px; text-decoration: none; }
.docs-main { min-width: 0; }
.docs-mobile-contents { display: none; }
.docs-prose { min-width: 0; line-height: 1.85; overflow-wrap: anywhere; }
.docs-prose :deep(h1) { margin: 0 0 14px; color: #172033; font-size: clamp(27px, 3vw, 34px); line-height: 1.3; font-weight: 650; letter-spacing: -.035em; }
.docs-prose :deep(h2) { margin: 46px 0 17px; padding-top: 26px; border-top: 1px solid #e8ecf2; color: #172033; font-size: 21px; line-height: 1.4; font-weight: 600; scroll-margin-top: 100px; }
.docs-prose :deep(h3) { margin: 24px 0 12px; color: #344054; font-size: 15px; font-weight: 600; }
.docs-prose :deep(p) { margin: 14px 0; }
.docs-prose :deep(ul),.docs-prose :deep(ol) { padding-left: 22px; margin: 18px 0; }
.docs-prose :deep(li) { padding-left: 3px; margin: 7px 0; }
.docs-prose :deep(a) { color: #2457e6; }
.docs-prose :deep(code) { padding: 2px 5px; border-radius: 3px; background: #f1f4f8; color: #3c526f; font-family: 'SFMono-Regular', Consolas, monospace; font-size: .88em; }
.docs-prose :deep(pre) { margin: 20px 0; padding: 18px 20px; border: 1px solid #e6ebf2; border-radius: 7px; background: #f8fafc; overflow-x: auto; font-size: 12px; line-height: 1.85; tab-size: 2; }
.docs-prose :deep(pre code) { padding: 0; background: none; font-size: inherit; overflow-wrap: normal; white-space: pre; }
.docs-prose :deep(blockquote) { margin: 24px 0; padding: 2px 18px; border-left: 3px solid #9bb2f1; background: #f5f8ff; color: #52617a; font-size: 13px; }
.docs-prose :deep(.doc-table-scroll) { max-width: 100%; margin: 20px 0; overflow-x: auto; }
.docs-prose :deep(table) { width: 100%; min-width: 540px; border-collapse: collapse; font-size: 12px; line-height: 1.8; }
.docs-prose :deep(th) { background: #f8fafc; color: #52617a; font-weight: 600; }
.docs-prose :deep(th),.docs-prose :deep(td) { padding: 11px 14px; border-bottom: 1px solid #e8ecf2; text-align: left; vertical-align: top; }
.docs-prose :deep(td:first-child) { min-width: 170px; }
.docs-footer { display: flex; justify-content: space-between; gap: 12px; padding-top: 24px; margin-top: 44px; border-top: 1px solid #e8ecf2; color: #8a96a8; font-size: 12px; }
.docs-footer a { color: #69758a; text-decoration: none; }
.docs-notice { position: fixed; bottom: 26px; left: 50%; max-width: calc(100% - 32px); padding: 10px 18px; border-radius: 7px; background: #172033; color: #fff; font-size: 13px; opacity: 0; transform: translate(-50%, 6px); pointer-events: none; transition: opacity .15s, transform .15s; }
.docs-notice.visible { opacity: 1; transform: translate(-50%, 0); }
@media (max-width: 760px) {
  .docs-header-inner { padding: 12px 18px; flex-wrap: wrap; gap: 12px; }
  .docs-brand { font-size: 13px; }
  .docs-actions { gap: 8px; }
  .docs-actions button { min-height: 40px; }
  .docs-layout { display: block; padding: 24px 18px; }
  .docs-sidebar { display: none; }
  .docs-mobile-contents { display: block; margin-bottom: 28px; padding-bottom: 14px; border-bottom: 1px solid #e8ecf2; color: #52617a; font-size: 13px; }
  .docs-mobile-contents summary { padding: 8px 0; cursor: pointer; }
  .docs-mobile-contents nav { display: grid; gap: 2px; margin-top: 10px; }
  .docs-mobile-contents a { display: block; padding: 10px 5px; color: #52617a; text-decoration: none; }
  .docs-prose :deep(h2) { font-size: 19px; margin-top: 34px; scroll-margin-top: 140px; }
  .docs-prose :deep(pre) { padding: 14px; }
}
@media (prefers-reduced-motion: reduce) { .docs-actions button,.docs-notice { transition: none; } }
</style>
