import { documentParts, encodeDocument, type InlineDocument, type InlineProduct } from "./inline-document.ts";

export function readEditor(root: Node): InlineDocument {
  let text = "";
  const products: InlineProduct[] = [];
  function walk(node: Node) {
    if (node.nodeType === 3) { text += node.textContent || ""; return; }
    if (node.nodeType !== 1 && node.nodeType !== 11) return;
    const element = node as Element;
    const id = element.getAttribute?.("data-product-id");
    if (id) { products.push({ id, name: element.getAttribute("data-product-name") || id, offset: text.length }); return; }
    if (element.getAttribute?.("data-editor-tail") !== null && element.hasAttribute?.("data-editor-tail")) return;
    if (element.tagName === "BR") { text += "\n"; return; }
    const block = element.tagName === "DIV" || element.tagName === "P";
    if (block && node !== root && text && !text.endsWith("\n")) text += "\n";
    for (const child of node.childNodes) walk(child);
    if (block && node !== root && node.nextSibling && !(node.nextSibling as Element).hasAttribute?.("data-editor-tail") && !text.endsWith("\n")) text += "\n";
  }
  // The root itself is an editor container, not an additional paragraph.
  for (const child of root.childNodes) walk(child);
  return { text, products };
}
export function editorSelection(root: HTMLElement): { from: number; to: number } | null {
  const selection = root.ownerDocument.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const before = range.cloneRange(); before.selectNodeContents(root); before.setEnd(range.startContainer, range.startOffset);
  const through = range.cloneRange(); through.selectNodeContents(root); through.setEnd(range.endContainer, range.endOffset);
  return { from: encodeDocument(readEditor(before.cloneContents())).length, to: encodeDocument(readEditor(through.cloneContents())).length };
}
export function setEditorSelection(root: HTMLElement, from: number, to = from) {
  function point(position: number): { node: Node; offset: number } {
    let remaining = Math.max(0, position);
    let found: { node: Node; offset: number } | undefined;
    function visit(node: Node) {
      if (found) return;
      if (node.nodeType === 3) {
        const length = node.textContent?.length || 0;
        if (remaining <= length) found = { node, offset: remaining };
        else remaining -= length;
      } else if (node.nodeType === 1) {
        const element = node as Element;
        if (element.hasAttribute("data-editor-tail")) return;
        if (element.hasAttribute("data-product-id") || element.tagName === "BR") {
          if (remaining <= 1) found = { node: node.parentNode!, offset: [...node.parentNode!.childNodes].indexOf(node as ChildNode) + remaining };
          else remaining--;
        } else for (const child of node.childNodes) visit(child);
      }
    }
    for (const child of root.childNodes) visit(child);
    return found || { node: root, offset: Math.max(0, root.childNodes.length - 1) };
  }
  const start = point(from), end = point(to), range = root.ownerDocument.createRange();
  range.setStart(start.node, start.offset); range.setEnd(end.node, end.offset);
  const selection = root.ownerDocument.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
}
export function renderEditor(root: HTMLElement, doc: InlineDocument, referencesDisabled: boolean) {
  const document = root.ownerDocument, fragment = document.createDocumentFragment();
  for (const part of documentParts(doc.text, doc.products)) {
    if (part.type === "text") { fragment.append(document.createTextNode(part.text)); continue; }
    const product = part.product, token = document.createElement("span");
    token.className = "chat-inline-product"; token.contentEditable = "false"; token.draggable = !referencesDisabled;
    token.dataset.productId = product.id; token.dataset.productName = product.name;
    token.setAttribute("role", "group"); token.setAttribute("aria-label", `引用产品：${product.name}`);
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24"); icon.setAttribute("width", "14"); icon.setAttribute("height", "14");
    icon.setAttribute("fill", "none"); icon.setAttribute("stroke", "currentColor"); icon.setAttribute("stroke-width", "1.8"); icon.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(icon.namespaceURI!, "path"); path.setAttribute("d", "m12 3 9 5v8l-9 5-9-5V8l9-5Zm0 10 9-5M12 13 3 8m9 5v8M7.5 5.5l9 5"); icon.append(path);
    const label = document.createElement("span"); label.textContent = product.name; label.title = product.name;
    token.append(icon, label); fragment.append(token);
  }
  const tail = document.createElement("br"); tail.dataset.editorTail = ""; fragment.append(tail);
  root.replaceChildren(fragment);
}
