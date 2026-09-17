import {
  bigserial,
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
  vector,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const admins = pgTable('admins', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  email: varchar('email', { length: 320 }).notNull(),
  passwordHash: text('password_hash').notNull(),
  displayName: varchar('display_name', { length: 120 }).notNull(),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('admins_email_lower_unique').on(sql`lower(${table.email})`)]);

export const roles = pgTable('roles', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  code: varchar('code', { length: 80 }).notNull().unique(),
  name: varchar('name', { length: 120 }).notNull(),
  isSystem: boolean('is_system').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const permissions = pgTable('permissions', {
  code: varchar('code', { length: 120 }).primaryKey(),
  description: text('description').notNull(),
});

export const adminRoles = pgTable('admin_roles', {
  adminId: bigint('admin_id', { mode: 'number' }).notNull().references(() => admins.id, { onDelete: 'cascade' }),
  roleId: bigint('role_id', { mode: 'number' }).notNull().references(() => roles.id, { onDelete: 'cascade' }),
}, (table) => [
  primaryKey({ columns: [table.adminId, table.roleId] }),
  index('admin_roles_role_id_idx').on(table.roleId),
]);

export const rolePermissions = pgTable('role_permissions', {
  roleId: bigint('role_id', { mode: 'number' }).notNull().references(() => roles.id, { onDelete: 'cascade' }),
  permissionCode: varchar('permission_code', { length: 120 }).notNull().references(() => permissions.code, { onDelete: 'cascade' }),
}, (table) => [
  primaryKey({ columns: [table.roleId, table.permissionCode] }),
  index('role_permissions_permission_code_idx').on(table.permissionCode),
]);

export const auditLogs = pgTable('audit_logs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  actorAdminId: bigint('actor_admin_id', { mode: 'number' }).notNull().references(() => admins.id, { onDelete: 'restrict' }),
  action: varchar('action', { length: 120 }).notNull(),
  targetType: varchar('target_type', { length: 80 }).notNull(),
  targetId: varchar('target_id', { length: 120 }).notNull(),
  details: jsonb('details').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('audit_logs_created_at_idx').on(table.createdAt),
  index('audit_logs_actor_created_at_idx').on(table.actorAdminId, table.createdAt),
]);

export const documents = pgTable('documents', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  title: varchar('title', { length: 200 }).notNull(),
  originalFilename: varchar('original_filename', { length: 255 }).notNull(),
  storageKey: varchar('storage_key', { length: 100 }).notNull().unique(),
  sha256: varchar('sha256', { length: 64 }).notNull(),
  byteSize: integer('byte_size').notNull(),
  uploadedBy: bigint('uploaded_by', { mode: 'number' }).notNull().references(() => admins.id, { onDelete: 'restrict' }),
  status: varchar('status', { length: 20 }).notNull().default('queued'),
  extractedText: text('extracted_text'),
  errorMessage: varchar('error_message', { length: 300 }),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('documents_created_at_idx').on(table.createdAt),
  index('documents_active_status_idx').on(table.status).where(sql`${table.archivedAt} IS NULL`),
]);

export const documentChunks = pgTable('document_chunks', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  documentId: bigint('document_id', { mode: 'number' }).notNull().references(() => documents.id, { onDelete: 'cascade' }),
  ordinal: integer('ordinal').notNull(),
  headingPath: text('heading_path').notNull().default(''),
  content: text('content').notNull(),
  sourceStartLine: integer('source_start_line').notNull(),
  sourceEndLine: integer('source_end_line').notNull(),
  embedding: vector('embedding', { dimensions: 2048 }),
  embeddingModel: varchar('embedding_model', { length: 120 }),
}, (table) => [
  uniqueIndex('document_chunks_document_id_ordinal_key').on(table.documentId, table.ordinal),
  index('document_chunks_document_id_idx').on(table.documentId),
]);
