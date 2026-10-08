import assert from 'node:assert/strict';
import test from 'node:test';
import { groupAdminNavigation } from '../src/admin-navigation.ts';

const views = ['audit', 'products', 'model-services', 'dashboard', 'admins', 'knowledge', 'roles', 'conversations']
  .map(id => ({ id, label: id }));

test('overview stays independent and three groups use fixed order, not source or active-route order', () => {
  const navigation = groupAdminNavigation(views);
  assert.deepEqual(navigation.root.map(item => item.id), ['dashboard']);
  assert.deepEqual(navigation.groups.map(group => group.label), ['业务管理', '平台配置', '系统管理']);
  assert.deepEqual(navigation.groups.map(group => group.items.map(item => item.id)), [
    ['conversations', 'knowledge', 'products'], ['model-services'], ['admins', 'roles', 'audit'],
  ]);
  assert.deepEqual(groupAdminNavigation([...views].reverse()), navigation);
  assert.deepEqual(views.map(item => item.id), ['audit', 'products', 'model-services', 'dashboard', 'admins', 'knowledge', 'roles', 'conversations']);
});

test('permission-filtered navigation never adds unavailable links and hides empty groups', () => {
  const navigation = groupAdminNavigation(views.filter(item => ['dashboard', 'knowledge', 'audit'].includes(item.id)));
  assert.deepEqual(navigation.groups.map(group => group.id), ['business', 'system']);
  assert.deepEqual(navigation.groups.flatMap(group => group.items.map(item => item.id)), ['knowledge', 'audit']);
});

test('every visible entry appears exactly once and grouped entries retain metadata', () => {
  const navigation = groupAdminNavigation(views);
  const items = [...navigation.root, ...navigation.groups.flatMap(group => group.items)];
  assert.equal(new Set(items.map(item => item.id)).size, views.length);
  assert.equal(items.length, views.length);
  assert.ok(items.every(item => views.includes(item)));
});

test('model-only, overview-only and no-permission accounts get only their available sections', () => {
  const modelOnly = groupAdminNavigation(views.filter(item => item.id === 'model-services'));
  assert.deepEqual(modelOnly.root, []);
  assert.deepEqual(modelOnly.groups.map(group => group.id), ['platform']);
  assert.deepEqual(groupAdminNavigation([{ id: 'dashboard' }]), { root: [{ id: 'dashboard' }], groups: [] });
  assert.deepEqual(groupAdminNavigation([]), { root: [], groups: [] });
});
