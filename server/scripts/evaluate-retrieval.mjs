import { readFile } from 'node:fs/promises';
import { adminSession } from './sample-admin-session.mjs';

const { baseUrl, token } = await adminSession();
const questionFile = process.env.EVAL_QUESTIONS || '../samples/eval/questions.md';
const source = await readFile(questionFile, 'utf8');
const cases = [...source.matchAll(/^\| (Q00[1-9]) \| ([^|]+) \| ([^|]+) \|/gm)]
  .map(([, id, question, expected]) => ({ id, question: question.trim(), expected: expected.trim() }));
if (cases.length !== 9) throw new Error(`Expected 9 standalone retrieval cases, got ${cases.length}`);

const totals = Object.fromEntries(['lexical', 'vector', 'fusion'].map((name) => [name, { top1: 0, top5: 0 }]));
for (const item of cases) {
  const url = new URL('/api/admin/search', baseUrl);
  url.searchParams.set('q', item.question);
  url.searchParams.set('limit', '5');
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${item.id}: search returned HTTP ${response.status}`);
  const data = await response.json();
  const outcomes = {};
  for (const [name, key] of [['lexical', 'lexicalResults'], ['vector', 'vectorResults'], ['fusion', 'fusionResults']]) {
    const hits = data[key] ?? [];
    const matches = hits.map((hit) => hit.originalFilename.startsWith(item.expected));
    const top1 = matches[0] === true;
    const top5 = matches.includes(true);
    totals[name].top1 += Number(top1);
    totals[name].top5 += Number(top5);
    outcomes[name] = { top1, top5, firstSource: hits[0]?.originalFilename ?? null };
  }
  console.log(JSON.stringify({ id: item.id, expected: item.expected, ...outcomes }));
}
console.log(JSON.stringify({ evaluated: cases.length, totals }));
