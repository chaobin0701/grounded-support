import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ProductDetail } from '../tools/product-catalog/product-catalog.service';
import type { SearchHit } from '../../documents/fuse-search-results';
import type { ToolResult } from '../tools/tool-result';
import { hasToolCapability } from '../tools/tool-capabilities';

// Only explicitly declared, bounded business fields can become model memory.
// This is not a dump of arbitrary tool payloads, credentials or instructions.
const productSchema = z.object({
  id: z.string().min(1).max(80), name: z.string().min(1).max(200), brand: z.string().max(200),
  categoryId: z.string().max(80), category: z.string().max(200), summary: z.string().max(2000),
  description: z.string().max(16000), suggestedPrice: z.string().max(1000).nullable().optional(),
  imageUrl: z.string().max(2000).nullable().optional(), sourceUrl: z.string().max(2000).nullable().optional(),
  specifications: z.record(z.string().max(200), z.string().max(2000)).refine(v => Object.keys(v).length <= 80),
  revision: z.string().min(1).max(200).optional(),
});
const hitSchema = z.object({
  chunkId: z.number().int().positive(), documentId: z.number().int().positive(),
  documentTitle: z.string().max(500), originalFilename: z.string().max(500),
  ordinal: z.number().int().nonnegative().optional(), headingPath: z.string().max(2000),
  content: z.string().max(16000), sourceStartLine: z.number().int().nullable(), sourceEndLine: z.number().int().nullable(),
  score: z.number().finite(), indexKind: z.enum(['live', 'published']).optional(),
  indexVersionId: z.number().int().positive().optional(), knowledgeBaseId: z.number().int().positive().optional(),
});
export type ContextResource =
  | { kind: 'product'; key: string; data: ProductDetail }
  | { kind: 'knowledge'; key: string; digest: string; data: SearchHit };
export type ContextProjector = (result: ToolResult) => ContextResource[];
export type RuntimeContextBlock = {
  version: 1; source: string; origin: 'model' | 'preload' | 'host';
  conversationId: string; traceId?: string; toolCallId?: string; occurredAt: string; resources: ContextResource[];
};
export type RestoredContext = {
  resources: ContextResource[]; products: ProductDetail[]; evidence: SearchHit[];
  historyProductIds: string[]; diagnostics: { enabled: boolean; candidates: number; restored: number; omitted: number };
};

export function evidenceDigest(hit: SearchHit): string {
  return createHash('sha256').update(JSON.stringify([hit.documentId, hit.documentTitle, hit.headingPath,
    hit.originalFilename, hit.content, hit.sourceStartLine, hit.sourceEndLine])).digest('hex');
}
export function canUseContextSource(source: string, allowedTools: readonly string[]): boolean {
  return allowedTools.includes(source) || (hasToolCapability(source, 'product-detail')
    && allowedTools.some(name => hasToolCapability(name, 'product-detail')));
}
export function productResources(result: ToolResult): ContextResource[] {
  if (!result.success) return [];
  const data = result.data as { products?: unknown[] } | undefined;
  const values = Array.isArray(data?.products) ? data.products.slice(0, 20) : [result.data];
  return values.flatMap(value => {
    const parsed = productSchema.safeParse(value);
    return parsed.success ? [{ kind: 'product' as const, key: `product:${parsed.data.id}`, data: parsed.data as ProductDetail }] : [];
  });
}
export function knowledgeResources(result: ToolResult): ContextResource[] {
  if (!result.success) return [];
  const data = result.data as { hits?: unknown[] } | undefined;
  return (Array.isArray(data?.hits) ? data.hits.slice(0, 24) : []).flatMap(value => {
    const parsed = hitSchema.safeParse(value);
    if (!parsed.success) return [];
    const hit = parsed.data as SearchHit;
    return [{ kind: 'knowledge' as const, key: `knowledge:${hit.indexKind ?? 'legacy'}:${hit.indexVersionId ?? 0}:${hit.chunkId}`,
      digest: evidenceDigest(hit), data: hit }];
  });
}
export function makeContextBlock(resources: ContextResource[], metadata: Omit<RuntimeContextBlock, 'version' | 'resources' | 'occurredAt'>, maxChars = 24000): RuntimeContextBlock | undefined {
  if (!metadata.conversationId || !/^[a-z][a-z0-9_]{0,79}$/u.test(metadata.source)) return;
  const selected: ContextResource[] = [];
  let used = 0;
  for (const raw of resources.slice(0, 24)) {
    const resource = normalizeResource(raw);
    if (!resource) continue;
    const chars = JSON.stringify(resource).length;
    if (used + chars > maxChars) continue;
    selected.push(resource); used += chars;
  }
  return selected.length ? { ...metadata, version: 1, occurredAt: new Date().toISOString(), resources: selected } : undefined;
}
export function normalizeResource(value: unknown): ContextResource | undefined {
  if (!value || typeof value !== 'object') return;
  const r = value as ContextResource;
  if (r.kind === 'product') return productResources({ success: true, content: '', data: r.data })[0];
  if (r.kind === 'knowledge') {
    const normalized = knowledgeResources({ success: true, content: '', data: { hits: [r.data] } })[0];
    if (normalized?.kind === 'knowledge' && normalized.digest === r.digest) return normalized;
  }
}
/** Snapshots are already owner-scoped by the conversation service; reject mismatched envelopes too. */
export function readContextBlocks(value: unknown, conversationId: string): RuntimeContextBlock[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap(raw => {
    if (!raw || typeof raw !== 'object') return [];
    const b = raw as RuntimeContextBlock;
    if (b.version !== 1 || b.conversationId !== conversationId || !['model', 'preload', 'host'].includes(b.origin)
      || typeof b.source !== 'string' || !Array.isArray(b.resources)) return [];
    const block = makeContextBlock(b.resources, { conversationId, source: b.source, origin: b.origin,
      ...(typeof b.traceId === 'string' ? { traceId: b.traceId } : {}),
      ...(b.origin === 'model' && typeof b.toolCallId === 'string' ? { toolCallId: b.toolCallId } : {}) });
    return block ? [{ ...block, occurredAt: typeof b.occurredAt === 'string' ? b.occurredAt : block.occurredAt }] : [];
  });
}
/** Read older traces without rewriting their original records or inventing native tool calls. */
export function legacyContextBlocks(snapshot: Record<string, unknown>, conversationId: string, traceId?: string): RuntimeContextBlock[] {
  const products = productResources({ success: true, content: '', data: { products: snapshot.products } });
  const blocks: RuntimeContextBlock[] = [];
  const productBlock = makeContextBlock(products, { conversationId, traceId, source: 'get_product_detail', origin: 'host' });
  if (productBlock) blocks.push(productBlock);
  for (const raw of Array.isArray(snapshot.productPreparation) ? snapshot.productPreparation : []) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as { name?: string; ok?: boolean; result?: unknown };
    if (entry.name !== 'search_knowledge' || entry.ok !== true) continue;
    const block = makeContextBlock(knowledgeResources({ success: true, content: '', data: entry.result }),
      { conversationId, traceId, source: 'search_knowledge', origin: 'preload' });
    if (block) blocks.push(block);
  }
  for (const raw of Array.isArray(snapshot.agentTranscript) ? snapshot.agentTranscript : []) {
    if (!raw || typeof raw !== 'object') continue;
    const message = raw as { role?: string; toolName?: string; content?: string };
    if (message.role !== 'tool' || message.toolName !== 'search_knowledge' || typeof message.content !== 'string') continue;
    try {
      const block = makeContextBlock(knowledgeResources({ success: true, content: '', data: JSON.parse(message.content) }),
        { conversationId, traceId, source: 'search_knowledge', origin: 'model' });
      if (block) blocks.push(block);
    } catch { /* Truncated or failed historical results are not reusable evidence. */ }
  }
  return blocks;
}
