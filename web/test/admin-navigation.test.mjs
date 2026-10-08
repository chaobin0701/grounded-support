import assert from 'node:assert/strict';
import test from 'node:test';
import { groupAdminNavigation } from '../src/admin-navigation.ts';

const views = ['audit', 'products', 'model-services', 'embedding-services', 'integrations', 'dashboard', 'admins', 'knowledge', 'roles', 'conversations', 'agent-config']
  .map(id => ({ id, label: id }));

test('overview stays independent and three groups use fixed order, not source or active-route order', () => {
  const navigation = groupAdminNavigation(views);
  assert.deepEqual(navigation.root.map(item => item.id), ['dashboard']);
  assert.deepEqual(navigation.groups.map(group => group.label), ['业务管理', '平台配置', '系统管理']);
  assert.deepEqual(navigation.groups.map(group => group.items.map(item => item.id)), [
    ['conversations', 'knowledge', 'products'], ['agent-config', 'model-services', 'embedding-services', 'integrations'], ['admins', 'roles'],
  ]);
  assert.deepEqual(groupAdminNavigation([...views].reverse()), navigation);
  assert.deepEqual(views.map(item => item.id), ['audit', 'products', 'model-services', 'embedding-services', 'integrations', 'dashboard', 'admins', 'knowledge', 'roles', 'conversations', 'agent-config']);
});

test('permission-filtered navigation never adds unavailable links and hides empty groups', () => {
  const navigation = groupAdminNavigation(views.filter(item => ['dashboard', 'knowledge', 'audit'].includes(item.id)));
  assert.deepEqual(navigation.groups.map(group => group.id), ['business']);
  assert.deepEqual(navigation.groups.flatMap(group => group.items.map(item => item.id)), ['knowledge']);
});

test('every visible entry appears exactly once and grouped entries retain metadata', () => {
  const navigation = groupAdminNavigation(views);
  const items = [...navigation.root, ...navigation.groups.flatMap(group => group.items)];
  assert.equal(new Set(items.map(item => item.id)).size, views.length - 1);
  assert.equal(items.length, views.length - 1);
  assert.ok(items.every(item => views.includes(item)));
});

test('audit stays hidden even when permission metadata includes it, without showing an empty group', () => {
  assert.deepEqual(groupAdminNavigation([{ id: 'audit' }]), { root: [], groups: [] });
  const navigation = groupAdminNavigation(views);
  assert.equal(navigation.groups.some(group => group.items.some(item => item.id === 'audit')), false);
});

test('model-only, overview-only and no-permission accounts get only their available sections', () => {
  const agentOnly = groupAdminNavigation(views.filter(item => item.id === 'agent-config'));
  assert.deepEqual(agentOnly.groups.map(group => group.items.map(item => item.id)), [['agent-config']]);
  const modelOnly = groupAdminNavigation(views.filter(item => item.id === 'model-services'));
  assert.deepEqual(modelOnly.root, []);
  assert.deepEqual(modelOnly.groups.map(group => group.id), ['platform']);
  assert.deepEqual(groupAdminNavigation([{ id: 'dashboard' }]), { root: [{ id: 'dashboard' }], groups: [] });
  assert.deepEqual(groupAdminNavigation([]), { root: [], groups: [] });
});
