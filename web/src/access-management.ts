import type { AdminItem, PermissionItem, RoleItem } from './admin-api';

const permissionLabels: Record<string, string> = { admins: '管理员', roles: '角色权限', documents: '文档', knowledge_bases: '知识库', conversations: '会话', agent_config: 'Agent 配置', model_profiles: '模型服务', embedding_profiles: 'Embedding 服务', integrations: '接入管理', audit: '操作记录' };
export function groupPermissions(permissions: readonly PermissionItem[]) {
  const groups = new Map<string, PermissionItem[]>();
  for (const permission of permissions) {
    const key = permission.code.split('.')[0] ?? 'other';
    groups.set(key, [...(groups.get(key) ?? []), permission]);
  }
  return [...groups].map(([key, items]) => ({ key, label: permissionLabels[key] ?? key, items }));
}
export function filterAdmins(items: readonly AdminItem[], query: string, status: string) {
  const keyword = query.trim().toLocaleLowerCase();
  return items.filter(item => (status === 'all' || (status === 'disabled' ? !!item.disabledAt : !item.disabledAt))
    && `${item.displayName} ${item.email ?? ''} ${item.username ?? ''} ${item.roles.map(role => role.code).join(' ')}`.toLocaleLowerCase().includes(keyword));
}
export function filterRoles(items: readonly RoleItem[], query: string, kind: string) {
  const keyword = query.trim().toLocaleLowerCase();
  return items.filter(item => (kind === 'all' || (kind === 'system' ? item.isSystem : !item.isSystem))
    && `${item.name} ${item.code}`.toLocaleLowerCase().includes(keyword));
}
