import assert from 'node:assert/strict';
import test from 'node:test';
import { filterAdmins, filterRoles, groupPermissions } from '../src/access-management.ts';
import { updateChoiceSelection } from '../src/ui/choice-list.ts';

const admins = [
  { id: 1, displayName: '超级管理员', email: 'Owner@example.com', disabledAt: null, roles: [{ id: 1, code: 'super_admin' }] },
  { id: 2, displayName: '资料编辑员', email: 'editor@example.com', disabledAt: null, roles: [{ id: 2, code: 'knowledge_editor' }] },
  { id: 3, displayName: '旧账号', email: 'old@example.com', disabledAt: '2026-10-01T00:00:00Z', roles: [] },
];
const roles = [
  { id: 1, name: '超级管理员', code: 'super_admin', isSystem: true, permissionCodes: ['admins.manage', 'roles.manage'] },
  { id: 2, name: '资料编辑员', code: 'knowledge_editor', isSystem: false, permissionCodes: ['documents.read'] },
];

test('username-only administrator is searchable without a fabricated email', () => {
  const user = { id: 4, displayName: '体验账号', email: null, username: 'demo-user', disabledAt: null, roles: [] };
  assert.deepEqual(filterAdmins([user], ' DEMO-USER ', 'enabled'), [user]);
  assert.deepEqual(filterAdmins([user], 'null', 'all'), []);
});

test('admin search matches name, email and role code, normalizes case and combines with status', () => {
  assert.deepEqual(filterAdmins(admins, ' OWNER@EXAMPLE ', 'all').map(item => item.id), [1]);
  assert.deepEqual(filterAdmins(admins, '编辑', 'enabled').map(item => item.id), [2]);
  assert.deepEqual(filterAdmins(admins, 'knowledge_editor', 'all').map(item => item.id), [2]);
  assert.deepEqual(filterAdmins(admins, '', 'disabled').map(item => item.id), [3]);
  assert.deepEqual(filterAdmins(admins, '旧账号', 'enabled'), []);
  assert.deepEqual(filterAdmins(admins, '   ', 'all'), admins);
});

test('role search and type filters preserve source order without mutation', () => {
  const before = JSON.stringify(roles);
  assert.deepEqual(filterRoles(roles, '', 'system').map(item => item.id), [1]);
  assert.deepEqual(filterRoles(roles, '', 'custom').map(item => item.id), [2]);
  assert.deepEqual(filterRoles(roles, ' KNOWLEDGE ', 'all').map(item => item.id), [2]);
  assert.deepEqual(filterRoles(roles, '超级', 'custom'), []);
  assert.equal(JSON.stringify(roles), before);
});

test('permission grouping preserves codes/descriptions and handles unknown namespaces', () => {
  const permissions = [
    { code: 'documents.read', description: '查看文档' },
    { code: 'roles.manage', description: '管理角色' },
    { code: 'documents.upload', description: '上传文档' },
    { code: 'new_module.read', description: '新的功能' },
  ];
  const groups = groupPermissions(permissions);
  assert.deepEqual(groups.map(group => [group.key, group.label]), [['documents', '文档'], ['roles', '角色权限'], ['new_module', 'new_module']]);
  assert.deepEqual(groups[0].items.map(item => item.code), ['documents.read', 'documents.upload']);
  assert.equal(groups[0].items[0], permissions[0]);
  assert.deepEqual(groupPermissions([]), []);
});

test('bulk selection cannot grant locked options, removes duplicates and preserves hidden selections', () => {
  const selected = ['hidden', 'locked-selected', 'hidden'];
  const options = [{ value: 'visible' }, { value: 'locked-new', disabled: true }, { value: 'locked-selected', disabled: true }];
  assert.deepEqual(updateChoiceSelection(selected, options, true), ['hidden', 'locked-selected', 'visible']);
  assert.deepEqual(updateChoiceSelection(['hidden', 'locked-selected', 'visible'], options, false), ['hidden', 'locked-selected']);
  assert.deepEqual(selected, ['hidden', 'locked-selected', 'hidden']);
});

test('numeric role selection supports single toggles and keeps other assigned roles', () => {
  assert.deepEqual(updateChoiceSelection([1, 2], [{ value: 3 }], true), [1, 2, 3]);
  assert.deepEqual(updateChoiceSelection([1, 2], [{ value: 1 }], false), [2]);
  assert.deepEqual(updateChoiceSelection([], [{ value: 1, disabled: true }], true), []);
});
