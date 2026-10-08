export const PRODUCT_TOKEN = "\uFFFC";
export type InlineProduct = { id: string; name: string; offset?: number };
export type InlineDocument = { text: string; products: InlineProduct[] };
export type InlinePart = { type: "text"; text: string } | { type: "product"; product: InlineProduct };
export type InlineMessageContext = {
  productIds?: string[];
  productReferences?: Array<{ productId: string; offset: number; length?: number }>;
  products?: Array<{ id: string; name: string }>;
};

export function normalizeDocument(text: string, products: InlineProduct[]): InlineDocument {
  text = text.replaceAll(PRODUCT_TOKEN, "").replace(/\r\n?/gu, "\n");
  const seen = new Set<string>();
  const refs = products.filter(product => {
    if (typeof product.id !== "string" || !product.id.trim() || product.id.length > 80 || typeof product.name !== "string" || seen.has(product.id.trim())) return false;
    seen.add(product.id.trim()); return true;
  }).slice(0, 5).map(product => ({ id: product.id.trim(), name: product.name.slice(0, 200), offset: Math.max(0, Math.min(text.length, Number.isInteger(product.offset) ? product.offset! : 0)) }));
  refs.sort((a, b) => a.offset - b.offset);
  return { text, products: refs };
}
export function documentParts(text: string, products: InlineProduct[]): InlinePart[] {
  const doc = normalizeDocument(text, products);
  const parts: InlinePart[] = [];
  let cursor = 0;
  for (const product of doc.products) {
    if (product.offset! > cursor) parts.push({ type: "text", text: doc.text.slice(cursor, product.offset) });
    parts.push({ type: "product", product }); cursor = product.offset!;
  }
  if (cursor < doc.text.length) parts.push({ type: "text", text: doc.text.slice(cursor) });
  return parts;
}
export function encodeDocument(doc: InlineDocument) {
  return documentParts(doc.text, doc.products).map(part => part.type === "text" ? part.text : PRODUCT_TOKEN).join("");
}
function decodeDocument(encoded: string, products: InlineProduct[]): InlineDocument {
  let text = "", index = 0;
  const refs: InlineProduct[] = [];
  for (const character of encoded) {
    if (character !== PRODUCT_TOKEN) text += character;
    else { const product = products[index++]; if (product) refs.push({ ...product, offset: text.length }); }
  }
  return normalizeDocument(text, refs);
}
export function sliceDocument(doc: InlineDocument, from: number, to: number): InlineDocument {
  const encoded = encodeDocument(doc), refs = normalizeDocument(doc.text, doc.products).products;
  const before = encoded.slice(0, from).split(PRODUCT_TOKEN).length - 1;
  const count = encoded.slice(from, to).split(PRODUCT_TOKEN).length - 1;
  return decodeDocument(encoded.slice(from, to), refs.slice(before, before + count));
}
export function replaceDocument(doc: InlineDocument, from: number, to: number, insert: InlineDocument): InlineDocument {
  const encoded = encodeDocument(doc);
  from = Math.max(0, Math.min(encoded.length, from)); to = Math.max(from, Math.min(encoded.length, to));
  const before = sliceDocument(doc, 0, from), after = sliceDocument(doc, to, encoded.length);
  return decodeDocument(encodeDocument(before) + encodeDocument(insert) + encodeDocument(after), [...before.products, ...normalizeDocument(insert.text, insert.products).products, ...after.products]);
}
export function moveReference(doc: InlineDocument, id: string, target: number): { document: InlineDocument; caret: number } | null {
  const refs = normalizeDocument(doc.text, doc.products).products;
  const index = refs.findIndex(product => product.id === id);
  if (index < 0) return null;
  const original = refs[index]!.offset! + index;
  const removed = replaceDocument(doc, original, original + 1, { text: "", products: [] });
  const insertion = Math.max(0, Math.min(encodeDocument(removed).length, target > original ? target - 1 : target));
  return { document: replaceDocument(removed, insertion, insertion, { text: "", products: [refs[index]!] }), caret: insertion + 1 };
}
export function clipboardText(doc: InlineDocument) {
  return documentParts(doc.text, doc.products).map(part => part.type === "text" ? part.text : part.product.name).join("");
}
/** Persist readable text, not editor placeholder tokens. Ranges replace names when rendered. */
export function serializeMessageDocument(doc: InlineDocument) {
  let question = "";
  const productReferences: Array<{ productId: string; offset: number; length: number }> = [];
  for (const part of documentParts(doc.text, doc.products)) {
    if (part.type === "text") question += part.text;
    else {
      const name = part.product.name.trim() || part.product.id;
      productReferences.push({ productId: part.product.id, offset: question.length, length: name.length });
      question += name;
    }
  }
  const leading = question.length - question.trimStart().length;
  question = question.trim();
  return { question, context: { productIds: productReferences.map(r => r.productId), ...(productReferences.length ? { productReferences: productReferences.map(r => ({ ...r, offset: r.offset - leading })) } : {}) } };
}
/** New ranges consume existing text; old offset-only references insert a label. */
export function messageDocument(text: string, context?: InlineMessageContext): InlineDocument {
  const ids = [...new Set(context?.productIds ?? [])].slice(0, 5);
  const references = ids.map(productId => context?.productReferences?.find(r => r.productId === productId) ?? { productId, offset: 0 });
  references.sort((a, b) => a.offset - b.offset);
  let plain = "", cursor = 0;
  const products: InlineProduct[] = [];
  for (const reference of references) {
    const { productId, offset, length } = reference;
    if (!Number.isInteger(offset) || offset < cursor || offset > text.length || (length !== undefined && (!Number.isInteger(length) || length < 1 || offset + length > text.length))) continue;
    plain += text.slice(cursor, offset);
    const name = length === undefined ? context?.products?.find(p => p.id === productId)?.name || productId : text.slice(offset, offset + length);
    products.push({ id: productId, name, offset: plain.length });
    cursor = offset + (length ?? 0);
  }
  return { text: plain + text.slice(cursor), products };
}
export function parseClipboardDocument(value: string): InlineDocument | null {
  try {
    const doc = JSON.parse(value);
    if (doc.version !== 1 || typeof doc.text !== "string" || doc.text.length > 2000 || !Array.isArray(doc.products) || doc.products.length > 5) return null;
    if (!doc.products.every((product: InlineProduct) => product && typeof product.id === "string" && product.id.trim() && product.id.length <= 80 && typeof product.name === "string" && product.name.length <= 200 && Number.isInteger(product.offset) && product.offset! >= 0 && product.offset! <= doc.text.length)) return null;
    return normalizeDocument(doc.text, doc.products);
  } catch { return null; }
}
export function trimmedDocument(doc: InlineDocument): InlineDocument {
  const leading = doc.text.length - doc.text.trimStart().length;
  return normalizeDocument(doc.text.trim(), doc.products.map(product => ({ ...product, offset: Math.max(0, (product.offset ?? 0) - leading) })));
}
