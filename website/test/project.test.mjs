import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
const read = (path) => readFile(resolve(root, path), "utf8");

test("独立 npm 项目、自己的锁文件、中文网页与必要规则", async () => {
  const manifest = JSON.parse(await read("package.json"));
  assert.equal(manifest.name, "hexu-corporate-website");
  for (const script of ["dev", "build", "test"])
    assert.ok(manifest.scripts[script]);
  assert.ok((await stat(resolve(root, "package-lock.json"))).isFile());
  assert.match(await read("index.html"), /lang="zh-CN"/);
  assert.match(await read("AGENTS.md"), /设计方向/);
  assert.match(await read("设计规范.md"), /Furni/);
});
test("品牌和服务资料只有一个目录，七份中文 Markdown 可下载", async () => {
  const names = await readdir(resolve(root, "资料"));
  assert.equal(names.length, 7);
  const page = await read("src/pages/SupportPage.vue");
  for (const name of names) {
    assert.match(name, /^[\u4e00-\u9fa5]+\.md$/);
    const markdown = await read(`资料/${name}`);
    assert.match(markdown, /^# /);
    assert.match(markdown, /2026-10-08/);
    assert.ok(markdown.length > 650);
    assert.ok(page.includes(name));
  }
  assert.match(page, /:download=/);
});
test("应用不导入旧官网实现、不含交易路由", async () => {
  async function inspect(path) {
    for (const entry of await readdir(resolve(root, path), {
      withFileTypes: true,
    })) {
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory()) await inspect(child);
      else assert.doesNotMatch(await read(child), /\.\.\/web\/src/);
    }
  }
  await inspect("src");
  assert.doesNotMatch(
    await read("src/router.ts"),
    /path: ['"]\/(cart|checkout|login)/,
  );
});
test("动态 API、净化富文本、图片失败和减少动效均保留", async () => {
  assert.match(
    await read("src/components/RichDescription.vue"),
    /DOMPurify\.sanitize/,
  );
  assert.match(await read("src/components/ProductImage.vue"), /@error/);
  assert.match(await read("src/style.css"), /prefers-reduced-motion/);
  assert.match(await read("src/pages/HomePage.vue"), /useProducts/);
  assert.match(await read("src/pages/ProductsPage.vue"), /useProducts/);
  assert.equal(
    (await stat(resolve(root, "public/images/舒适生活.png"))).size > 100000,
    true,
  );
});
