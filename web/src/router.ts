import { createRouter, createWebHistory } from 'vue-router';

export const adminSections = ['dashboard', 'knowledge', 'products', 'conversations', 'agent-config', 'model-services', 'embedding-services', 'integrations', 'admins', 'roles', 'audit'] as const;

const routeSurface = { template: '<span />' };

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'chat', component: routeSurface },
    { path: '/docs/integration', name: 'integration-docs', component: routeSurface },
    { path: '/admin', name: 'admin-login', component: routeSurface },
    { path: '/admin/documents', redirect: '/admin/knowledge' },
    { path: '/admin/knowledge/:baseId(\\d+)', redirect: (to) => `/admin/knowledge/${to.params.baseId}/documents` },
    { path: '/admin/knowledge/:baseId(\\d+)/:legacy(index|config|publish|versions|search|faq)', redirect: (to) => {
      const tab = ['index', 'config'].includes(String(to.params.legacy)) ? 'settings'
        : ['publish', 'versions', 'search'].includes(String(to.params.legacy)) ? 'recall-test' : 'documents';
      return `/admin/knowledge/${to.params.baseId}/${tab}`;
    } },
    { path: '/admin/knowledge/:baseId(\\d+)/documents/:documentId(\\d+)', name: 'admin-knowledge-document', component: routeSurface },
    { path: '/admin/knowledge/:baseId(\\d+)/:subview(documents|settings|recall-test)', name: 'admin-knowledge-subview', component: routeSurface },
    { path: '/admin/conversations/:conversationId', name: 'admin-conversation-detail', component: routeSurface },
    { path: '/admin/:section(dashboard|knowledge|products|conversations|agent-config|model-services|embedding-services|integrations|admins|roles|audit)', name: 'admin-section', component: routeSurface },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});
