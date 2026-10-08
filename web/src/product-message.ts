import type { ConversationMessage } from './chat-api';

export type ProductMessagePart = { type: 'text'; text: string } | { type: 'product'; id: string; name: string };

/** Ranges style existing names; offset-only legacy metadata inserts missing names. */
export function productMessageParts(content: string, context?: ConversationMessage['context']): ProductMessagePart[] {
  const ids = [...new Set(context?.productIds ?? [])].slice(0, 5);
  const references = ids.map(productId => context?.productReferences?.find(r => r.productId === productId) ?? { productId, offset: 0 });
  references.sort((a, b) => a.offset - b.offset);
  const parts: ProductMessagePart[] = [];
  let cursor = 0;
  for (const { productId, offset, length } of references) {
    if (!Number.isInteger(offset) || offset < cursor || offset > content.length || (length !== undefined && (!Number.isInteger(length) || length < 1 || offset + length > content.length))) continue;
    if (offset > cursor) parts.push({ type: 'text', text: content.slice(cursor, offset) });
    parts.push({ type: 'product', id: productId, name: length === undefined ? context?.products?.find(p => p.id === productId)?.name || productId : content.slice(offset, offset + length) });
    cursor = offset + (length ?? 0);
  }
  if (cursor < content.length) parts.push({ type: 'text', text: content.slice(cursor) });
  return parts;
}
