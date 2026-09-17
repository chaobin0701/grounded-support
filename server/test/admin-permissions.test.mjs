import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { AdminAuthService } from '../dist/admin/admin-auth.service.js';
import { AdminManagementController } from '../dist/admin/admin-management.controller.js';
import { PERMISSION_KEY } from '../dist/admin/permission.decorator.js';

test('me returns current roles and deduplicated effective permissions', async () => {
  const database = {
    query: async (statement) => statement.includes('SELECT r.id::int')
      ? { rows: [{ id: 2, code: 'editor', name: '资料编辑' }] }
      : { rows: [{ code: 'documents.read' }, { code: 'documents.upload' }] },
  };
  const auth = new AdminAuthService(database, {});
  assert.deepEqual(await auth.me({ id: 7, email: 'editor@example.com', displayName: '编辑' }), {
    id: 7, email: 'editor@example.com', displayName: '编辑',
    roles: [{ id: 2, code: 'editor', name: '资料编辑' }],
    permissionCodes: ['documents.read', 'documents.upload'],
  });
});

test('role listing accepts either role management or admin management permission', () => {
  const required = Reflect.getMetadata(PERMISSION_KEY, AdminManagementController.prototype.listRoles);
  assert.deepEqual(required, ['roles.manage', 'admins.manage']);
  assert.deepEqual(Reflect.getMetadata(PERMISSION_KEY, AdminManagementController.prototype.createRole), ['roles.manage']);
});
