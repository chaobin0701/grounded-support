const groupDefinitions = [
  { id: 'business', label: '业务管理', views: ['conversations', 'knowledge', 'products'] },
  { id: 'platform', label: '平台配置', views: ['model-services'] },
  { id: 'system', label: '系统管理', views: ['admins', 'roles', 'audit'] },
] as const;

// Only group already-authorized entries. Selection never changes their order.
export function groupAdminNavigation<T extends { id: string }>(availableViews: readonly T[]) {
  return {
    root: availableViews.filter(item => item.id === 'dashboard'),
    groups: groupDefinitions.map(group => ({
      id: group.id,
      label: group.label,
      items: group.views.map(id => availableViews.find(item => item.id === id))
        .filter((item): item is T => item !== undefined),
    })).filter(group => group.items.length > 0),
  };
}
