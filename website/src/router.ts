import { createRouter, createWebHistory } from "vue-router";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      component: () => import("./pages/HomePage.vue"),
      meta: { title: "禾序智能 · 让日常，井然舒适" },
    },
    {
      path: "/products",
      component: () => import("./pages/ProductsPage.vue"),
      meta: { title: "产品中心 · 禾序智能" },
    },
    {
      path: "/products/:id",
      component: () => import("./pages/ProductDetailPage.vue"),
      meta: { title: "产品详情 · 禾序智能" },
    },
    {
      path: "/about",
      component: () => import("./pages/AboutPage.vue"),
      meta: { title: "关于我们 · 禾序智能" },
    },
    {
      path: "/support",
      component: () => import("./pages/SupportPage.vue"),
      meta: { title: "服务支持 · 禾序智能" },
    },
    {
      path: "/assistant/:conversationId?",
      name: "assistant",
      component: () => import("./pages/AssistantPage.vue"),
      meta: { title: "在线助手 · 禾序智能" },
    },
    {
      path: "/:pathMatch(.*)*",
      component: () => import("./pages/NotFoundPage.vue"),
      meta: { title: "页面未找到 · 禾序智能" },
    },
  ],
  scrollBehavior(to, _from, saved) {
    return saved || (to.hash ? { el: to.hash, top: 100 } : { top: 0 });
  },
});
router.afterEach((to) => {
  document.title = String(to.meta.title);
});
