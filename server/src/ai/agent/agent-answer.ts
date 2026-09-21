import type { SearchHit } from '../../documents/fuse-search-results';
import type { ChatAnswer } from '../../chat/chat.service';
import { validateAnswer } from './citation-validation';
import type { ProductDetail, ProductSummary } from '../tools/product-catalog/product-catalog.service';

export const REFUSAL = '无法确定，建议联系人工。';

export function validateAgentAnswer(
  raw: string,
  hits: SearchHit[],
  products: Array<ProductSummary | ProductDetail>,
): ChatAnswer {
  const refusal: ChatAnswer = { answer: REFUSAL, refused: true, citations: [] };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.status === 'refused') return refusal;
    if (parsed.status !== 'answered' || typeof parsed.answer !== 'string' || !parsed.answer.trim() || parsed.answer.length > 1200) return refusal;
    const citationIds = parsed.citationIds;
    const productIds = parsed.productIds;
    if (!Array.isArray(citationIds) || !Array.isArray(productIds) || citationIds.length + productIds.length === 0 || citationIds.length > 5 || productIds.length > 10) return refusal;
    const byProduct = new Map(products.map((product) => [product.id, product]));
    if (productIds.some((id) => typeof id !== 'string' || !byProduct.has(id))) return refusal;
    const citations = citationIds.length ? validateAnswer(JSON.stringify({ status: 'answered', answer: parsed.answer, citationIds }), hits) : null;
    if (citations?.refused) return refusal;
    const answer = products.reduce((text, product) => text.replaceAll(product.id, ''), parsed.answer.trim()).replace(/ {2,}/gu, ' ').trim();
    return { answer, refused: false, citations: citations?.citations || [] };
  } catch {
    return refusal;
  }
}
