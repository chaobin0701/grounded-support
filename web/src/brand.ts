export const siteBrand = {
  name: '禾序智能客服',
  assistantName: '禾序 · AI 助手',
  icon: '/favicon.svg',
} as const;

export function pageTitle(path: string) {
  if (path === '/docs/integration') return `接入文档 · ${siteBrand.name}`;
  if (path === '/admin' || path.startsWith('/admin/')) return `${siteBrand.name} · 管理中心`;
  return siteBrand.name;
}
