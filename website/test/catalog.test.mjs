import test from "node:test";
import assert from "node:assert/strict";
import {
  categoryOptions,
  fetchProduct,
  fetchProducts,
  filterProducts,
  isProduct,
  safeUrl,
} from "../src/catalog.ts";

const product = {
  id: "heater",
  brand: "Midea",
  name: "美的暖风机 HFT20ZBJ",
  categoryId: "heating",
  category: "取暖",
  summary: "小空间取暖",
  description: "型号资料",
  suggestedPrice: null,
  imageUrl: null,
  sourceUrl: null,
  specifications: { 功率: "2000 W" },
};
const air = {
  ...product,
  id: "air",
  brand: "Xiaomi",
  name: "米家空气净化器 Pro",
  categoryId: "air",
  category: "空气",
};

test("目录只接受完整、类型正确的数据", () => {
  assert.equal(isProduct(product), true);
  for (const value of [
    null,
    {},
    { ...product, id: "" },
    { ...product, specifications: [] },
    { ...product, specifications: { 功率: 2000 } },
    { ...product, imageUrl: 2 },
  ])
    assert.equal(isProduct(value), false);
});
test("分类与关键词叠加筛选、大小写和首尾空格", () => {
  assert.equal(filterProducts([product, air], "", "").length, 2);
  assert.deepEqual(filterProducts([product, air], "heating", " hft20zbj "), [
    product,
  ]);
  assert.deepEqual(filterProducts([product, air], "air", "XIAOMI"), [air]);
  assert.deepEqual(filterProducts([product, air], "heating", "Pro"), []);
  assert.deepEqual(filterProducts([product, air], "missing", ""), []);
});
test("类别由目录生成并去重，不写死分类", () => {
  assert.deepEqual(
    categoryOptions([product, { ...product, id: "another" }, air]),
    [
      { id: "heating", name: "取暖" },
      { id: "air", name: "空气" },
    ],
  );
  assert.deepEqual(categoryOptions([]), []);
});
test("外链只允许完整 HTTP/HTTPS，拒绝脚本、data 与伪协议", () => {
  assert.equal(
    safeUrl("https://www.mi.com/airpro"),
    "https://www.mi.com/airpro",
  );
  assert.equal(safeUrl("http://localhost:8848"), "http://localhost:8848/");
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,<script/>",
    "file:///etc/passwd",
    "//evil.example",
    "/relative",
    "",
    null,
  ])
    assert.equal(safeUrl(url), "");
});

async function withFetch(implementation, run) {
  const original = globalThis.fetch;
  globalThis.fetch = implementation;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}
test("列表请求真实产品 API，无硬编码回退", async () => {
  await withFetch(
    async (url, options) => {
      assert.equal(url, "/api/products");
      assert.ok(options.signal);
      return Response.json([product, air]);
    },
    async () => assert.deepEqual(await fetchProducts(), [product, air]),
  );
});
test("空目录是有效结果", async () => {
  await withFetch(
    async () => Response.json([]),
    async () => assert.deepEqual(await fetchProducts(), []),
  );
});
test("详情编码 ID 并校验返回数据", async () => {
  await withFetch(
    async (url) => {
      assert.equal(url, "/api/products/a%2Fb");
      return Response.json(product);
    },
    async () => assert.deepEqual(await fetchProduct("a/b"), product),
  );
});
test("404 显示产品不存在，不使用旧目录替代", async () => {
  await withFetch(
    async () => new Response("", { status: 404 }),
    async () => assert.rejects(fetchProduct("missing"), /不存在或已下架/),
  );
});
test("服务错误和网络失败具有中文可操作提示", async () => {
  await withFetch(
    async () => new Response("", { status: 503 }),
    async () => assert.rejects(fetchProducts(), /稍后重试/),
  );
  await withFetch(
    async () => {
      throw new TypeError("Failed to fetch");
    },
    async () => assert.rejects(fetchProducts(), /检查网络后重试/),
  );
});
test("非 JSON 和错误字段结构不得视为成功", async () => {
  await withFetch(
    async () => new Response("<html>bad gateway</html>"),
    async () => assert.rejects(fetchProducts(), /格式异常/),
  );
  await withFetch(
    async () => Response.json([{}]),
    async () => assert.rejects(fetchProducts(), /格式异常/),
  );
  await withFetch(
    async () => Response.json({}),
    async () => assert.rejects(fetchProduct("bad"), /格式异常/),
  );
});
test("调用者取消信号传递到请求且不被吞掉", async () => {
  const controller = new AbortController();
  controller.abort();
  await withFetch(
    async (_url, options) => {
      assert.equal(options.signal.aborted, true);
      throw new DOMException("Aborted", "AbortError");
    },
    async () =>
      assert.rejects(fetchProducts(controller.signal), { name: "AbortError" }),
  );
});
