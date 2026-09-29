import { z } from 'zod';

export const PLANNER_TOOL_NAMES = [
  'search_knowledge',
  'list_product_categories',
  'list_products',
  'get_product_detail',
  'mcp_product_catalog_list_product_categories',
  'mcp_product_catalog_list_products',
  'mcp_product_catalog_get_product_detail',
] as const;

export const plannerToolSchema = z.object({
  type: z.literal('tool').optional(),
  name: z.enum(PLANNER_TOOL_NAMES),
  arguments: z.record(z.string(), z.unknown()),
});

export type PlannerToolCall = z.infer<typeof plannerToolSchema>;

export type ParsedPlannerOutput = {
  final: Record<string, unknown> | null;
  toolCalls: PlannerToolCall[];
  parseMode: 'json' | 'json_batch' | 'json_with_dsml' | 'dsml' | 'invalid';
  error?: string;
};

type JsonCandidate = { value: unknown; end: number };

/**
 * Models that use a provider-specific chat template can append DSML tool tags
 * even when the prompt asks for JSON. Keep this normalization at the planner
 * boundary so the rest of the AgentLoop still receives the existing tool shape.
 */
export function parsePlannerOutput(raw: string): ParsedPlannerOutput {
  const source = stripCodeFence(raw.trim());
  const json = extractJsonCandidate(source);
  const dsml = parseDsmlCalls(source);

  if (json) {
    const jsonResult = normalizeJsonValue(json.value);
    if (jsonResult.error) {
      return { final: null, toolCalls: [], parseMode: 'invalid', error: jsonResult.error };
    }

    if (jsonResult.final && dsml.calls.length > 0) {
      return { final: null, toolCalls: [], parseMode: 'invalid', error: 'final_output_contains_tool_calls' };
    }
    if (dsml.error) {
      return { final: null, toolCalls: [], parseMode: 'invalid', error: dsml.error };
    }

    if (jsonResult.final) return { final: jsonResult.final, toolCalls: [], parseMode: 'json' };
    const merged = dedupeCalls([...jsonResult.toolCalls, ...dsml.calls]);
    if (!merged.length) return { final: null, toolCalls: [], parseMode: 'invalid', error: 'no_tool_call' };
    return {
      final: null,
      toolCalls: merged,
      parseMode: dsml.calls.length > 0 ? 'json_with_dsml' : (merged.length > 1 ? 'json_batch' : 'json'),
    };
  }

  if (dsml.error) return { final: null, toolCalls: [], parseMode: 'invalid', error: dsml.error };
  if (dsml.calls.length > 0) return { final: null, toolCalls: dsml.calls, parseMode: 'dsml' };
  return { final: null, toolCalls: [], parseMode: 'invalid', error: 'unsupported_planner_output' };
}

function normalizeJsonValue(value: unknown): {
  final: Record<string, unknown> | null;
  toolCalls: PlannerToolCall[];
  error?: string;
} {
  if (isRecord(value) && value.type === 'final') return { final: value, toolCalls: [] };

  const candidates: unknown[] = Array.isArray(value)
    ? value
    : isRecord(value) && (value.type === 'tools' || Array.isArray(value.calls)) && Array.isArray(value.calls)
      ? value.calls
      : [value];
  const calls: PlannerToolCall[] = [];
  for (const candidate of candidates) {
    const parsed = plannerToolSchema.safeParse(candidate);
    if (!parsed.success) return { final: null, toolCalls: [], error: 'invalid_tool_call_json' };
    calls.push(parsed.data);
  }
  return { final: null, toolCalls: dedupeCalls(calls) };
}

function parseDsmlCalls(source: string): { calls: PlannerToolCall[]; error?: string } {
  if (!source.includes('<｜｜DSML｜｜')) return { calls: [] };
  const calls: PlannerToolCall[] = [];
  const invokePattern = /<｜｜DSML｜｜\s*invoke\b([^>]*)>([\s\S]*?)<\/｜｜DSML｜｜\s*invoke\s*>/gu;
  for (const match of source.matchAll(invokePattern)) {
    const attributes = parseAttributes(match[1] ?? '');
    const name = attributes.name;
    if (!name) return { calls: [], error: 'dsml_invoke_missing_name' };
    const args = parseDsmlArguments(match[2] ?? '');
    if (!args.ok) return { calls: [], error: args.error };
    const parsed = plannerToolSchema.safeParse({ type: 'tool', name, arguments: args.value });
    if (!parsed.success) return { calls: [], error: 'dsml_tool_not_allowed' };
    calls.push(parsed.data);
  }

  // Some providers emit a self-closing invoke tag for a call without args.
  const selfClosingPattern = /<｜｜DSML｜｜\s*invoke\b([^>]*?)\/\s*>/gu;
  for (const match of source.matchAll(selfClosingPattern)) {
    const attributes = parseAttributes(match[1] ?? '');
    const name = attributes.name;
    if (!name) return { calls: [], error: 'dsml_invoke_missing_name' };
    const parsed = plannerToolSchema.safeParse({ type: 'tool', name, arguments: {} });
    if (!parsed.success) return { calls: [], error: 'dsml_tool_not_allowed' };
    calls.push(parsed.data);
  }
  return { calls: dedupeCalls(calls) };
}

function parseDsmlArguments(body: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const content = body.trim();
  if (!content) return { ok: true, value: {} };
  const json = extractJsonCandidate(content);
  if (json && content.slice(json.end).trim() === '' && isRecord(json.value)) return { ok: true, value: json.value };

  const values: Record<string, unknown> = {};
  const parameterPattern = /<｜｜DSML｜｜\s*parameter\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/｜｜DSML｜｜\s*parameter\s*>)/gu;
  let found = false;
  for (const match of content.matchAll(parameterPattern)) {
    found = true;
    const attributes = parseAttributes(match[1] ?? '');
    const name = attributes.name;
    if (!name) return { ok: false, error: 'dsml_parameter_missing_name' };
    const raw = attributes.value ?? attributes.string ?? (match[2] ?? '').trim();
    values[name] = coerceValue(raw, attributes.type);
  }
  return found ? { ok: true, value: values } : { ok: false, error: 'dsml_arguments_not_supported' };
}

function coerceValue(value: string, type?: string): unknown {
  if (type === 'number') {
    const number = Number(value);
    return Number.isFinite(number) ? number : value;
  }
  if (type === 'boolean') return value === 'true';
  if (type === 'json') {
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
}

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([A-Za-z_][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gu;
  for (const match of source.matchAll(pattern)) attributes[match[1]!] = match[2] ?? match[3] ?? match[4] ?? '';
  return attributes;
}

function extractJsonCandidate(source: string): JsonCandidate | null {
  const start = source.search(/[\[{]/u);
  if (start < 0) return null;
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === '{' || char === '[') { stack.push(char); continue; }
    if (char === '}' || char === ']') {
      const opening = stack.pop();
      if ((char === '}' && opening !== '{') || (char === ']' && opening !== '[')) return null;
      if (stack.length === 0) {
        try { return { value: JSON.parse(source.slice(start, index + 1)), end: index + 1 }; } catch { return null; }
      }
    }
  }
  return null;
}

function stripCodeFence(value: string): string {
  return value.replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '').trim();
}

function dedupeCalls(calls: PlannerToolCall[]): PlannerToolCall[] {
  const seen = new Set<string>();
  return calls.filter((call) => {
    const key = JSON.stringify({ name: call.name, arguments: call.arguments });
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
