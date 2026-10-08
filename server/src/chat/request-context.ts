import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

/** UTF-16 range in readable question text. Legacy offset-only references insert a label. */
export type ProductReference = { productId: string; offset: number; length?: number };
export type RequestContext = { productIds?: string[]; productReferences?: ProductReference[] };
export type MessageContext = RequestContext & { products?: Array<{ id: string; name: string }> };
const contextSchema = z.object({
  productIds: z.array(z.string().trim().min(1).max(80)).transform(ids => [...new Set(ids)]).refine(ids => ids.length <= 5, '最多关联 5 个产品').optional(),
  productReferences: z.array(z.object({ productId: z.string().trim().min(1).max(80), offset: z.number().int().min(0).max(2000), length: z.number().int().min(1).max(200).optional() }).strict()).max(5).optional(),
}).strict().superRefine((context, issue) => {
  const seen = new Set<string>();
  for (const reference of context.productReferences ?? []) {
    if (!context.productIds?.includes(reference.productId) || seen.has(reference.productId)) issue.addIssue({ code: z.ZodIssueCode.custom, message: '引用必须对应唯一的关联产品 ID' });
    seen.add(reference.productId);
  }
});

export function normalizeRequestContext(value?: unknown, question?: string): RequestContext {
  const parsed = contextSchema.safeParse(value ?? {});
  if (!parsed.success) throw new BadRequestException('产品上下文格式无效：最多 5 个合法 ID；引用必须对应关联产品');
  const references: ProductReference[] = (parsed.data.productReferences ?? []).map(({ productId, offset, length }) => ({ productId, offset, ...(length !== undefined ? { length } : {}) })).sort((a, b) => a.offset - b.offset);
  let end = 0;
  for (const ref of references) {
    if (ref.offset < end || ref.offset + (ref.length ?? 0) > (question?.length ?? Infinity)) throw new BadRequestException('产品引用不能重叠或超出问题正文');
    end = ref.offset + (ref.length ?? 0);
  }
  return parsed.data.productIds?.length ? { productIds: parsed.data.productIds, ...(references.length ? { productReferences: references } : {}) } : {};
}
export function contextFingerprint(value?: RequestContext): string {
  const ids = [...(value?.productIds ?? [])].sort();
  return value?.productReferences?.length ? JSON.stringify({ productIds: ids, productReferences: [...value.productReferences].sort((a, b) => a.offset - b.offset) }) : JSON.stringify(ids);
}

export function messageContext(value?: unknown, products?: unknown): MessageContext {
  const context = normalizeRequestContext(value);
  const labels = Array.isArray(products) ? products.filter((p): p is { id: string; name: string } => !!p && typeof p === 'object' && typeof p.id === 'string' && typeof p.name === 'string' && !!context.productIds?.includes(p.id)).map(({ id, name }) => ({ id, name })) : [];
  return { ...context, ...(labels.length ? { products: labels } : {}) };
}
