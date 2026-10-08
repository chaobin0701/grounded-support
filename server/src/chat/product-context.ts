import type { ProductDetail } from '../ai/tools/product-catalog/product-catalog.service';
import type { AgentTranscriptMessage } from './agent-transcript';

export function isProductDetail(value: unknown): value is ProductDetail {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  return typeof p.id === 'string' && typeof p.name === 'string' && typeof p.description === 'string'
    && !!p.specifications && typeof p.specifications === 'object' && !Array.isArray(p.specifications)
    && Object.values(p.specifications).every(value => typeof value === 'string');
}

/** Preserve call/result pairs; replace repeated payloads, never delete a native tool result alone. */
export function projectProductTranscript(transcript: AgentTranscriptMessage[], canonicalIds: ReadonlySet<string>): AgentTranscriptMessage[] {
  const calls = new Map(transcript.flatMap(m => (m.toolCalls ?? []).map(call => [call.id, call] as const)));
  return transcript.map(message => {
    if (message.role !== 'tool' || !message.toolCallId) return message;
    const call = calls.get(message.toolCallId);
    if (!call || !['get_product_detail', 'mcp_product_catalog_get_product_detail'].includes(call.name)) return message;
    const id = call.arguments.productId;
    if (typeof id !== 'string' || !canonicalIds.has(id)) return message;
    try { if (JSON.parse(message.content ?? '{}')?.error) return message; } catch { /* Truncated successful JSON is still replaced by a reference. */ }
    return { ...message, content: JSON.stringify({ productRef: id, detailLocation: 'productContext.products', note: '历史结果，当前有效详情或不可用状态见 productContext' }) };
  });
}
