import test from "node:test";
import assert from "node:assert/strict";
import { parseMarkdown } from "../src/chat/markdown.ts";
test("Markdown 正确显示中文加粗、段落、标题与有序/无序列表", () => {
  const html = parseMarkdown(
    "## 产品规格\n\n- **额定功率**：1500 W\n- **档位**：三档\n\n**价格和适用面积**：尚未提供。\n\n1. 查看产品\n2. 咨询服务",
  );
  assert.match(html, /<h2>产品规格<\/h2>/);
  assert.match(html, /<strong>额定功率<\/strong>/);
  assert.match(html, /<strong>价格和适用面积<\/strong>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<ol>/);
  assert.doesNotMatch(html, /\*\*额定功率\*\*/);
});
test("表格与代码块可独立滚动，代码内容不作为 HTML 执行", () => {
  const html = parseMarkdown(
    "| 参数 | 值 |\n| --- | --- |\n| 功率 | 1500W |\n\n```html\n<script>alert(1)</script>\n```",
  );
  assert.match(html, /class="chat-markdown-table"/);
  assert.match(html, /<table>/);
  assert.match(html, /<pre><code/);
  assert.match(html, /&lt;script&gt;/);
});
test("禁止模型原始 HTML、危险链接与自动加载图片；外链有安全属性", () => {
  const html = parseMarkdown(
    "<img src=x onerror=alert(1)>\n\n<script>alert(1)</script>\n\n[危险](javascript:alert%281%29)\n\n[正常](https://example.com/path?q=1)\n\n![图片说明](https://example.com/tracker.png)",
  );
  assert.doesNotMatch(html, /<img|<script|href="javascript|tracker\.png/);
  assert.match(html, /noopener noreferrer/);
  assert.match(html, /图片说明/);
});
test("未闭合的流式 Markdown 可安全呈现并在收到后续文本时正确重排", () => {
  assert.equal(typeof parseMarkdown("**额定功"), "string");
  assert.match(
    parseMarkdown("**额定功率**：1500 W"),
    /<strong>额定功率<\/strong>/,
  );
});
