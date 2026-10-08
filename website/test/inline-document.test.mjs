import test from "node:test";
import assert from "node:assert/strict";
import { PRODUCT_TOKEN as token, clipboardText, documentParts, encodeDocument, messageDocument, moveReference, normalizeDocument, parseClipboardDocument, replaceDocument, serializeMessageDocument, sliceDocument, trimmedDocument } from "../src/chat/inline-document.ts";
const product = (id, offset = 0) => ({ id, name: `产品${id}`, offset });
test("引用在正文中间/换行后原位编码，Unicode 使用 UTF-16 光标位置", () => {
  const doc = { text: "看看🙂\n适合卧室吗？", products: [product("1", 5), product("2", 6)] };
  assert.equal(encodeDocument(doc), `看看🙂\n${token}适${token}合卧室吗？`);
  assert.deepEqual(documentParts(doc.text, doc.products).filter(part => part.type === "product").map(part => part.product.offset), [5, 6]);
  assert.equal(clipboardText(doc), "看看🙂\n产品1适产品2合卧室吗？");
});
test("从 / 命令替换为内联引用，仅删除命令；前后正文和其他引用不丢失", () => {
  const doc = { text: "21321 /\n哪个好？", products: [product("1", 0)] };
  const encoded = encodeDocument(doc), from = encoded.indexOf("/");
  const result = replaceDocument(doc, from, from + 1, { text: "", products: [product("2")] });
  assert.equal(result.text, "21321 \n哪个好？");
  assert.deepEqual(result.products, [product("1", 0), product("2", 6)]);
  assert.equal(encodeDocument(result), `${token}21321 ${token}\n哪个好？`);
});
test("文本插入与换行自动移动后续引用位置；退格/Delete 可删除任意位置的引用", () => {
  const doc = { text: "比较两款", products: [product("1", 2), product("2", 4)] };
  const edited = replaceDocument(doc, 2, 2, { text: "\n", products: [] });
  assert.deepEqual(edited.products, [product("1", 3), product("2", 5)]);
  const removed = replaceDocument(edited, 3, 4, { text: "", products: [] });
  assert.equal(removed.text, "比较\n两款");
  assert.deepEqual(removed.products, [product("2", 5)]);
  const selected = replaceDocument(doc, 1, 5, { text: "另一个", products: [] });
  assert.equal(selected.text, "比另一个");
  assert.deepEqual(selected.products, [product("2", 4)]);
});
test("产品可以向前/后拖动到换行位置，操作不修改正文也不重复引用", () => {
  const doc = { text: "第一段\n第二段", products: [product("1", 0), product("2", 5)] };
  const moved = moveReference(doc, "1", encodeDocument(doc).length);
  assert.equal(moved.document.text, doc.text);
  assert.deepEqual(moved.document.products, [product("2", 5), product("1", 7)]);
  assert.equal(encodeDocument(moved.document), `第一段\n第${token}二段${token}`);
  const back = moveReference(moved.document, "1", 4);
  assert.equal(back.document.products.find(p => p.id === "1").offset, 4);
  assert.equal(moveReference(doc, "missing", 0), null);
});
test("剪切粘贴保留引用结构，普通复制输出名称，非法 HTML/引用载荷不执行", () => {
  const doc = { text: "前\n后", products: [product("1", 2)] };
  const slice = sliceDocument(doc, 1, 4);
  assert.equal(encodeDocument(slice), `\n${token}后`);
  assert.deepEqual(parseClipboardDocument(JSON.stringify({ version: 1, ...slice })), slice);
  const pasted = replaceDocument({ text: "目标", products: [] }, 1, 1, slice);
  assert.equal(encodeDocument(pasted), `目\n${token}后标`);
  for (const raw of ["<img onerror=alert(1)>", "null", JSON.stringify({ version: 1, text: "a", products: [{ ...product("1"), offset: 2 }] }), JSON.stringify({ version: 1, text: "a", products: [{ id: 1, name: "x", offset: 0 }] })]) assert.equal(parseClipboardDocument(raw), null);
});
test("去重与五个上限不改变纯文本，首尾空白修正引用偏移", () => {
  const doc = normalizeDocument("问题", [product("1", 2), product(" 1 ", 1), ...[2,3,4,5,6].map(id => product(String(id)))]);
  assert.equal(doc.products.length, 5); assert.equal(new Set(doc.products.map(p => p.id)).size, 5);
  assert.deepEqual(trimmedDocument({ text: " \n问题  ", products: [product("1", 3), product("2", 6)] }), { text: "问题", products: [product("1", 1), product("2", 2)] });
});
test("发送正文包含产品名称，范围只用于样式，不强制添加或移除换行", () => {
  for (const text of ["这个产品怎么样", "这个产品怎么样\n"]) {
    const doc = { text, products: [{ id: "xiaomi-electric-warmer", name: "米家电暖器", offset: text.length }] };
    const serialized = serializeMessageDocument(doc);
    assert.equal(serialized.question, `${text}米家电暖器`);
    assert.deepEqual(serialized.context, { productIds: ["xiaomi-electric-warmer"], productReferences: [{ productId: "xiaomi-electric-warmer", offset: text.length, length: 5 }] });
    const restored = messageDocument(serialized.question, serialized.context);
    assert.deepEqual(restored, doc);
    assert.equal(clipboardText(restored), serialized.question);
    assert.equal(documentParts(restored.text, restored.products).filter(p => p.type === "product").length, 1);
  }
});
test("多引用、空白和 emoji 的可读正文与编辑器位置可以往返，不重复名称", () => {
  const doc = { text: "  前🙂\n后  ", products: [product("1", 3), product("2", 6)] };
  const serialized = serializeMessageDocument(doc);
  assert.equal(serialized.question, "前产品1🙂\n产品2后");
  assert.deepEqual(serialized.context.productReferences, [{ productId: "1", offset: 1, length: 3 }, { productId: "2", offset: 7, length: 3 }]);
  const restored = messageDocument(serialized.question, { ...serialized.context, products: [{ id: "1", name: "已改名" }, { id: "2", name: "另一名称" }] });
  assert.equal(restored.text, "前🙂\n后");
  assert.deepEqual(restored.products, [product("1", 1), product("2", 4)]);
  assert.equal(clipboardText(restored), serialized.question);
  assert.deepEqual(serializeMessageDocument(restored), serialized);
  const onlyProduct = serializeMessageDocument({ text: "  ", products: [{ id: "1", name: " 米家电暖器 ", offset: 1 }] });
  assert.deepEqual(onlyProduct, { question: "米家电暖器", context: { productIds: ["1"], productReferences: [{ productId: "1", offset: 0, length: 5 }] } });
});
test("旧的 offset 引用仍插入名称，非法范围不会吞掉正文", () => {
  const legacy = messageDocument("这个产品怎么样", { productIds: ["1"], productReferences: [{ productId: "1", offset: 7 }], products: [{ id: "1", name: "米家电暖器" }] });
  assert.equal(clipboardText(legacy), "这个产品怎么样米家电暖器");
  assert.deepEqual(messageDocument("普通问题"), { text: "普通问题", products: [] });
  for (const reference of [{ offset: -1, length: 3 }, { offset: 2, length: 3 }, { offset: 1, length: 0 }, { offset: 1.5, length: 1 }]) {
    assert.deepEqual(messageDocument("正文", { productIds: ["1"], productReferences: [{ productId: "1", ...reference }] }), { text: "正文", products: [] });
  }
});
