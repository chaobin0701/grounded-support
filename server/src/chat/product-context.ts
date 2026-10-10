import type { ProductDetail } from '../ai/tools/product-catalog/product-catalog.service';
import type { AgentTranscriptMessage } from './agent-transcript';
import { hasToolCapability } from '../ai/tools/tool-capabilities';

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
    if (!call || !hasToolCapability(call.name, 'product-detail')) return message;
    const id = call.arguments.productId;
    if (typeof id !== 'string' || !canonicalIds.has(id)) return message;
    try { if (JSON.parse(message.content ?? '{}')?.error) return message; } catch { /* Truncated successful JSON is still replaced by a reference. */ }
    return { ...message, content: JSON.stringify({ productRef: id, detailLocation: 'productContext.products', note: '历史结果，当前有效详情或不可用状态见 productContext' }) };
  });
}

/** Keep native call/result pairs while the governed evidence set owns the only result body. */
export function projectEvidenceTranscript(transcript: AgentTranscriptMessage[], evidenceIds: ReadonlySet<number>): AgentTranscriptMessage[] {
  const calls = new Map(transcript.flatMap(m => (m.toolCalls ?? []).map(call => [call.id, call] as const)));
  return transcript.map(message => {
    if (message.role !== 'tool' || !message.toolCallId || calls.get(message.toolCallId)?.name !== 'search_knowledge') return message;
    try {
      const result = JSON.parse(message.content ?? '{}');
      if (result.error || !Array.isArray(result.hits)) return message;
      const ids: number[] = result.hits.map((hit: { chunkId?: number }) => hit?.chunkId).filter((id: unknown): id is number => Number.isSafeInteger(id));
      return { ...message, content: JSON.stringify({ evidenceRefs: ids.filter(id => evidenceIds.has(id)),
        unavailableEvidenceIds: ids.filter(id => !evidenceIds.has(id)), detailLocation: 'initialEvidence',
        note: '仅本轮提供的片段可作为当前资料；历史片段未恢复时可补充检索' }) };
    } catch { return message; }
  });
}
