import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { parse, compileScript } from '@vue/compiler-sfc';
import ts from 'typescript';

const file = new URL('../src/ui/ChatProgress.vue', import.meta.url);
const { descriptor } = parse(await readFile(file, 'utf8'));
let source = ts.transpileModule(compileScript(descriptor, { id: 'process-render-test', inlineTemplate: true }).content, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
source = source.replace(/(from\s*["'])([^"']+)(["'])/gu, (_all, start, specifier, end) => start + import.meta.resolve(specifier) + end);
const ChatProgress = (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).default;
const render = props => renderToString(createSSRApp({ render: () => h(ChatProgress, props) }));

test('紧凑过程实际渲染：运行/完成/未完成可区分，纯文本说明，空列表无面板', async () => {
  assert.doesNotMatch(await render({ steps: [] }), /<details/);
  const steps = [
    { key: 'one', type: 'progress', id: 'one-end', stage: 'tool', status: 'completed', text: '已查看产品目录', durationMs: 1234, resultCount: 8 },
    { key: 'two', type: 'progress', id: 'two-start', stage: 'tool', status: 'running', text: '正在读取产品详细规格' },
  ];
  const running = await render({ steps });
  assert.match(running, /<details[^>]* open/);
  assert.match(running, /aria-label="查看产品目录，已完成"/);
  assert.match(running, /aria-label="读取产品详细规格，进行中"/);
  assert.match(running, /lucide-wrench/);
  assert.doesNotMatch(running, /lucide-check|已查看|正在读取/);
  assert.match(running, /class="[^"]*\bspinning\b[^"]*"/);
  assert.doesNotMatch(running, /1234|8 条|数据查询|回答整理|process-step-meta/);
  const settled = await render({ steps, settled: true, commentary: [{ id: 'model', type: 'commentary', text: '<img src=x>我先查看产品目录。' }] });
  assert.doesNotMatch(settled, /<details[^>]* open|class="[^"]*\bspinning\b[^"]*"|<img/);
  assert.match(settled, /未完成/);
  assert.match(settled, /&lt;img src=x&gt;/);
});
test('步骤中隐藏回答生成，仅计算工具调用且使用扳手图标', async () => {
  const answer = { key: 'answer', type: 'progress', id: 'answer-end', stage: 'answer', status: 'completed', text: '回答生成完成' };
  assert.doesNotMatch(await render({ steps: [answer], settled: true }), /<details|回答生成/);
  const result = await render({ settled: true, steps: [answer, { key: 'categories', type: 'progress', id: 'categories-end', stage: 'tool', status: 'completed', text: '已查看产品分类' }] });
  assert.match(result, /<small>1 步<\/small>/);
  assert.match(result, /<span>查看产品分类<\/span>/);
  assert.match(result, /lucide-wrench/);
  assert.doesNotMatch(result, /回答生成|已查看|lucide-check/);
});
