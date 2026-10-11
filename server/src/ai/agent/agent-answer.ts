import type { SearchHit } from '../../documents/fuse-search-results';
import type { ChatAnswer } from '../../chat/chat.service';
import { validateAnswer } from './citation-validation';
import type { ProductDetail, ProductSummary } from '../tools/product-catalog/product-catalog.service';

export const REFUSAL = '无法确定，建议联系人工。';
export const RECOVERY_REFUSAL = '我暂时没能读取到足够的资料，无法可靠回答这次问题。你可以换一种说法，或稍后再试。';

export function validateAgentAnswer(
  raw: string,
  hits: SearchHit[],
  products: Array<ProductSummary | ProductDetail>,
  _responseMode = 'auto',
  _evidenceRequired = false,
): ChatAnswer {
  const refusal: ChatAnswer = { answer: REFUSAL, refused: true, citations: [] };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.status === 'refused') {
      return typeof parsed.answer === 'string' && parsed.answer.trim()
        ? { answer: parsed.answer.trim(), refused: true, citations: [] }
        : refusal;
    }
    if (parsed.status !== 'answered' || typeof parsed.answer !== 'string' || !parsed.answer.trim()) return refusal;
    const citationIds = parsed.citationIds;
    const productIds = parsed.productIds;
    if (!Array.isArray(citationIds) || !Array.isArray(productIds)) return refusal;
    const byProduct = new Map(products.map((product) => [product.id, product]));

    // This first version validates the response protocol only. The model may
    // reuse evidence from a prior turn that is present in the transcript but not
    // rehydrated into this turn's state. Matching citations are display metadata;
    // unresolved citations never invalidate an otherwise valid answer.
    const validCitationIds = citationIds.filter((id): id is number =>
      Number.isInteger(id) && hits.some((hit) => hit.chunkId === id),
    );
    const citations = validCitationIds.length
      ? validateAnswer(JSON.stringify({ status: 'answered', answer: parsed.answer, citationIds: validCitationIds }), hits)
      : null;
    const answer = [...byProduct.values()]
      .reduce((text, product) => text.replaceAll(product.id, ''), parsed.answer.trim())
      .replace(/ {2,}/gu, ' ')
      .trim();
    return { answer, refused: false, citations: citations?.citations || [] };
  } catch {
    return refusal;
  }
}
