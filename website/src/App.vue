<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { ArrowUpRight, Menu, X } from "@lucide/vue";
import { brand } from "./brand";
import { chat } from "./chat/service";
import FloatingAssistant from "./components/FloatingAssistant.vue";
import ToastNotice from "./components/ToastNotice.vue";
const route = useRoute();
const isAssistant = computed(() => route.path === "/assistant");
const menuOpen = ref(false);
const main = ref<HTMLElement | null>(null);
const menuButton = ref<HTMLButtonElement | null>(null);
const links = [
  { to: "/", text: "首页" },
  { to: "/products", text: "产品中心" },
  { to: "/about", text: "关于我们" },
  { to: "/support", text: "服务支持" },
];
function active(path: string) {
  return path === "/" ? route.path === "/" : route.path.startsWith(path);
}
function closeMenu() {
  menuOpen.value = false;
  menuButton.value?.focus();
}
function openConsultation() {
  menuOpen.value = false;
  chat.openWidget();
}
watch(
  () => route.path,
  async () => {
    menuOpen.value = false;
    if (route.path === "/assistant") chat.closeWidget();
    await nextTick();
    main.value?.focus({ preventScroll: true });
  },
);
</script>

<template>
  <div class="site-shell" :class="{ 'site-shell--assistant': isAssistant }">
    <a class="skip-link" href="#main-content">跳到主要内容</a>
    <header class="site-header">
      <div class="container header-inner">
        <RouterLink to="/" class="brand-logo" aria-label="禾序智能首页"
          ><img
            src="/images/禾序标志.png"
            alt="禾序智能科技"
            width="2172"
            height="724"
        /></RouterLink>
        <nav class="desktop-nav" aria-label="主导航">
          <RouterLink
            v-for="link in links"
            :key="link.to"
            :to="link.to"
            :class="{ active: active(link.to) }"
            :aria-current="active(link.to) ? 'page' : undefined"
            >{{ link.text }}</RouterLink
          >
        </nav>
        <button
          v-if="!isAssistant"
          type="button"
          class="header-consult"
          @click="openConsultation"
        >
          在线咨询 <ArrowUpRight :size="17" />
        </button>
        <RouterLink
          v-else
          class="header-consult"
          to="/assistant"
          aria-current="page"
          >在线助手</RouterLink
        >
        <button
          ref="menuButton"
          class="menu-button"
          type="button"
          :aria-expanded="menuOpen"
          aria-controls="mobile-nav"
          :aria-label="menuOpen ? '关闭导航' : '打开导航'"
          @click="menuOpen = !menuOpen"
        >
          <X v-if="menuOpen" :size="23" /><Menu v-else :size="23" />
        </button>
      </div>
      <nav
        v-if="menuOpen"
        id="mobile-nav"
        class="mobile-nav container"
        aria-label="移动端导航"
        @keydown.esc="closeMenu"
      >
        <RouterLink
          v-for="link in links"
          :key="link.to"
          :to="link.to"
          :aria-current="active(link.to) ? 'page' : undefined"
          >{{ link.text }}</RouterLink
        ><button v-if="!isAssistant" type="button" @click="openConsultation">
          在线咨询</button
        ><RouterLink v-else to="/assistant">在线助手</RouterLink>
      </nav>
    </header>
    <main id="main-content" ref="main" tabindex="-1"><RouterView /></main>
    <footer
      class="site-footer"
      :class="{ 'site-footer--compact': isAssistant }"
    >
      <div v-if="!isAssistant" class="container footer-main">
        <div class="footer-brand">
          <RouterLink to="/" class="brand-logo"
            ><img
              src="/images/禾序标志.png"
              alt="禾序智能科技"
              width="2172"
              height="724"
          /></RouterLink>
          <p>让日常，井然舒适。</p>
        </div>
        <div>
          <h2>探索禾序</h2>
          <RouterLink to="/about">关于我们</RouterLink
          ><RouterLink to="/products">产品中心</RouterLink>
        </div>
        <div>
          <h2>需要帮助</h2>
          <RouterLink to="/support">使用与服务支持</RouterLink
          ><RouterLink to="/support#documents">中文资料下载</RouterLink>
        </div>
        <div class="footer-note">
          <p>关注家的温度与空气，<br />也关注每一次安心的选择。</p>
        </div>
      </div>
      <div class="container footer-bottom">
        <span>© {{ new Date().getFullYear() }} {{ brand.company }}</span
        ><span v-if="!isAssistant"
          >虚拟品牌学习展示 · 美的、小米产品保留原品牌，无合作或代理关系</span
        ><span v-if="!isAssistant"
          >设计参考
          <a
            href="https://untree.co/demos/furni/"
            target="_blank"
            rel="noopener noreferrer"
            >Furni / Untree.co</a
          ></span
        >
        <nav v-if="isAssistant" aria-label="页脚导航">
          <RouterLink to="/about">关于我们</RouterLink
          ><RouterLink to="/support">服务支持</RouterLink>
        </nav>
      </div>
    </footer>
    <FloatingAssistant />
    <ToastNotice />
  </div>
</template>
