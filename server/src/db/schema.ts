import {
  bigserial,
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
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

export const visitorSessions = pgTable('visitor_sessions', {
  id: uuid('id').primaryKey(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
});

export const mcpCapabilities = pgTable('mcp_capabilities', {
  id: varchar('id', { length: 80 }).primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  transport: varchar('transport', { length: 20 }).notNull(),
  manifestKey: varchar('manifest_key', { length: 120 }).notNull().unique(),
  enabled: boolean('enabled').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: bigint('updated_by', { mode: 'number' }).references(() => admins.id, { onDelete: 'set null' }),
});

export const mcpToolPolicies = pgTable('mcp_tool_policies', {
  capabilityId: varchar('capability_id', { length: 80 }).notNull().references(() => mcpCapabilities.id, { onDelete: 'cascade' }),
  toolName: varchar('tool_name', { length: 120 }).notNull(),
  displayName: varchar('display_name', { length: 120 }).notNull(),
  enabled: boolean('enabled').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: bigint('updated_by', { mode: 'number' }).references(() => admins.id, { onDelete: 'set null' }),
}, (table) => [primaryKey({ columns: [table.capabilityId, table.toolName] })]);

export const chatDisplaySettings = pgTable('chat_display_settings', {
  id: smallint('id').primaryKey(),
  publicProgressEnabled: boolean('public_progress_enabled').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: bigint('updated_by', { mode: 'number' }).references(() => admins.id, { onDelete: 'set null' }),
});

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey(),
  visitorSessionId: uuid('visitor_session_id').notNull().references(() => visitorSessions.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 120 }).notNull().default('新对话'),
  summary: text('summary').notNull().default(''),
  summaryThroughMessageId: bigint('summary_through_message_id', { mode: 'number' }),
  busyUntil: timestamp('busy_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('conversations_visitor_updated_idx').on(table.visitorSessionId, table.updatedAt)]);

export const conversationMessages = pgTable('conversation_messages', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 12 }).notNull(),
  content: text('content').notNull(),
  refused: boolean('refused'),
  citations: jsonb('citations').notNull().default([]),
  toolSteps: jsonb('tool_steps').notNull().default([]),
  progressEvents: jsonb('progress_events').notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('conversation_messages_conversation_id_idx').on(table.conversationId, table.id)]);

export const chatTraces = pgTable('chat_traces', {
  id: uuid('id').primaryKey(),
  kind: varchar('kind', { length: 20 }).notNull().default('answer'),
  conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }),
  userMessageId: bigint('user_message_id', { mode: 'number' }).references(() => conversationMessages.id, { onDelete: 'set null' }),
  question: text('question').notNull(),
  contextSnapshot: jsonb('context_snapshot').notNull().default({}),
  model: varchar('model', { length: 120 }),
  rawModelOutput: text('raw_model_output'),
  finalAnswer: text('final_answer'),
  refused: boolean('refused'),
  status: varchar('status', { length: 20 }).notNull(),
  errorCode: varchar('error_code', { length: 80 }),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  totalTokens: integer('total_tokens'),
  durationMs: integer('duration_ms').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('chat_traces_created_at_idx').on(table.createdAt),
  index('chat_traces_conversation_id_idx').on(table.conversationId, table.createdAt),
]);
