import { createRouter, createWebHistory } from 'vue-router';

export const adminSections = ['dashboard', 'knowledge', 'products', 'conversations', 'admins', 'roles', 'audit'] as const;

const routeSurface = { template: '<span />' };

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'chat', component: routeSurface },
    { path: '/product', name: 'product', component: routeSurface },
    { path: '/help', name: 'help', component: routeSurface },
    { path: '/admin', name: 'admin-login', component: routeSurface },
    { path: '/admin/documents', redirect: '/admin/knowledge' },
    { path: '/admin/:section(dashboard|knowledge|products|conversations|admins|roles|audit)', name: 'admin-section', component: routeSurface },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});
