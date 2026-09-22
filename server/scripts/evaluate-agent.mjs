import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContextBuilder } from '../dist/chat/context-builder.js';
import { AgentLoop } from '../dist/ai/agent/agent-loop.js';
import { AgentRunner } from '../dist/ai/agent/agent-runner.js';
import { ToolExecutionService } from '../dist/ai/tools/tool-execution.js';
import { ToolPolicy } from '../dist/ai/tools/tool-policy.js';
import { customerSupportSkill } from '../dist/ai/skills/built-in/customer-support.skill.js';
import { productConsultationSkill } from '../dist/ai/skills/built-in/product-consultation.skill.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const expectedPath = path.join(root, 'samples/eval/expected.json');

export async function loadCases() {
  return JSON.parse(await fs.readFile(expectedPath, 'utf8')).cases;
}

const hit = {
  chunkId: 12, documentId: 3, documentTitle: '退货政策', originalFilename: 'returns.md', ordinal: 0,
  headingPath: '退货条件', content: '七天内可申请退货。', sourceStartLine: 2, sourceEndLine: 4, score: 0.86,
};
const h2 = { id: 'heater-h2', name: '暖巢 H2 陶瓷暖风机', categoryId: 'heating', summary: '适合卧室的小型陶瓷暖风机。', keySpecifications: ['额定功率：1500 W', '档位：三档'] };
const h2Detail = { ...h2, specifications: { 额定功率: '1500 W', 档位: '三档', 额定电压: '220 V' } };

function fixtureTool(name, data, content = JSON.stringify(data)) {
  return { name, description: name, inputSchema: { safeParse: (input) => ({ success: true, data: input }) }, execute: async () => ({ success: true, content, data }) };
}

function createCaseRuntime(testCase) {
  const responses = {
    'returns-basic': [{ type: 'tool', name: 'search_knowledge', arguments: { query: '退货期限' } }, { type: 'final', status: 'answered', answer: '七天内可申请退货。', citationIds: [12], productIds: [] }],
    'returns-citation': [{ type: 'tool', name: 'search_knowledge', arguments: { query: '退货政策' } }, { type: 'final', status: 'answered', answer: '七天内可申请退货。', citationIds: [12], productIds: [] }],
    'unsupported-refusal': [{ type: 'tool', name: 'search_knowledge', arguments: { query: '海外配送' } }, { type: 'final', status: 'refused', answer: '无法确定，建议联系人工。', citationIds: [], productIds: [] }],
    'product-list': [{ type: 'tool', name: 'mcp_product_catalog_list_products', arguments: {} }, { type: 'final', status: 'answered', answer: '暖巢 H2 是产品之一。', citationIds: [], productIds: ['heater-h2'] }],
    'product-detail': [{ type: 'tool', name: 'mcp_product_catalog_list_products', arguments: {} }, { type: 'tool', name: 'mcp_product_catalog_get_product_detail', arguments: { productId: 'heater-h2' } }, { type: 'final', status: 'answered', answer: 'H2 额定功率为 1500 W，三档。', citationIds: [], productIds: ['heater-h2'] }],
    'duplicate-call': [{ type: 'tool', name: 'search_knowledge', arguments: { query: '退货政策' } }, { type: 'tool', name: 'search_knowledge', arguments: { query: '退货政策' } }],
    'tool-limit': [{ type: 'tool', name: 'search_knowledge', arguments: { query: '退货政策 1' } }, { type: 'tool', name: 'search_knowledge', arguments: { query: '退货政策 2' } }, { type: 'tool', name: 'search_knowledge', arguments: { query: '退货政策 3' } }, { type: 'tool', name: 'search_knowledge', arguments: { query: '退货政策 4' } }],
    'session-isolation': [{ type: 'tool', name: 'search_knowledge', arguments: { query: '退货政策' } }, { type: 'final', status: 'answered', answer: '七天内可申请退货。', citationIds: [12], productIds: [] }],
  }[testCase.id];
  const llm = { model: 'offline-eval-model', completeDetailed: async () => { const next = responses.shift(); return { content: JSON.stringify(next ?? { type: 'final', status: 'refused', answer: '无法确定，建议联系人工。', citationIds: [], productIds: [] }), model: 'offline-eval-model', inputTokens: 100, outputTokens: 20, totalTokens: 120 }; } };
  const tools = [fixtureTool('search_knowledge', testCase.id === 'unsupported-refusal' ? { hits: [] } : { hits: [hit] }, testCase.id === 'unsupported-refusal' ? '没有找到相关资料。' : '[12] 退货政策：七天内可申请退货。'), fixtureTool('mcp_product_catalog_list_products', { total: 1, products: [h2] }), fixtureTool('mcp_product_catalog_get_product_detail', h2Detail)];
  const registry = { get: (name) => { const tool = tools.find((item) => item.name === name); if (!tool) throw new Error(`unknown fixture tool: ${name}`); return tool; } };
  const runner = new AgentRunner(new AgentLoop(llm, new ContextBuilder(), new ToolExecutionService(registry, new ToolPolicy())), new ContextBuilder());
  return { runner, skill: testCase.skill === 'product_consultation' ? productConsultationSkill : customerSupportSkill };
}

export async function evaluateCase(testCase) {
  const started = Date.now();
  const { runner, skill } = createCaseRuntime(testCase);
  const result = await runner.run({ question: testCase.question, summary: '', recentHistory: [], skill });
  const expected = testCase.expected;
  const traces = result.toolCalls;
  const keys = traces.map((trace) => JSON.stringify({ name: trace.name, arguments: trace.arguments }));
  const duplicateCount = keys.length - new Set(keys).size;
  const checks = {
    refused: result.result.refused === expected.refused,
    citationRequired: expected.citationRequired === undefined || (expected.citationRequired ? result.result.citations.length > 0 : true),
    evidenceDocument: !expected.evidenceDocument || result.sources.some((source) => source.originalFilename === expected.evidenceDocument && (expected.mustContain ?? []).every((text) => source.content.includes(text))),
    productId: !expected.productId || result.products.some((product) => product.id === expected.productId),
    noDuplicateToolCalls: !expected.noDuplicateToolCalls || duplicateCount === 0,
    duplicateCount: expected.duplicateCount === undefined || duplicateCount >= expected.duplicateCount,
    maxToolCalls: expected.maxToolCalls === undefined || traces.length <= expected.maxToolCalls,
    toolCallCountAtMost: expected.toolCallCountAtMost === undefined || traces.length <= expected.toolCallCountAtMost,
    sessionEvidenceMustNotContain: !expected.sessionEvidenceMustNotContain || !JSON.stringify(result.contextSnapshot).includes(expected.sessionEvidenceMustNotContain),
  };
  return { caseId: testCase.id, passed: Object.values(checks).every(Boolean), checks, refused: result.result.refused, toolCalls: { count: traces.length, duplicates: duplicateCount, names: traces.map((trace) => trace.name) }, usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens, totalTokens: result.totalTokens }, latencyMs: Date.now() - started, skill: result.skill };
}

export async function evaluate(cases, onlyCase) {
  const selected = onlyCase ? cases.filter((item) => item.id === onlyCase) : cases;
  if (onlyCase && selected.length === 0) throw new Error(`Unknown evaluation case: ${onlyCase}`);
  const results = await Promise.all(selected.map(evaluateCase));
  return { version: 1, mode: 'offline', passed: results.every((result) => result.passed), summary: { total: results.length, passed: results.filter((result) => result.passed).length, failed: results.filter((result) => !result.passed).length }, cases: results };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const onlyCase = process.argv[process.argv.indexOf('--case') + 1];
  const report = await evaluate(await loadCases(), process.argv.includes('--case') ? onlyCase : undefined);
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}
