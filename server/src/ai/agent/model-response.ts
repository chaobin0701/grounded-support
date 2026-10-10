import { z } from 'zod';
import type { LlmToolCall } from '../providers/provider.types';

const nativeCall = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()),
});
const finalResponse = z.object({
  type: z.literal('final'),
  status: z.enum(['answered', 'refused']),
  answer: z.string().trim().min(1),
  citationIds: z.array(z.number().int()),
  productIds: z.array(z.string()),
}).strict();

export class AgentProtocolError extends Error {
  readonly code = 'model_protocol_error';
  constructor(readonly reason: string) {
    super('Model response violates the Agent protocol');
    this.name = 'AgentProtocolError';
  }
}

export type AgentModelResponse =
  | { mode: 'native'; calls: LlmToolCall[]; commentary?: string }
  | { mode: 'final'; final: z.infer<typeof finalResponse> };

// Commentary is optional public copy, never raw content or a reasoning field.
// A malformed/missing commentary must not prevent a valid native call.
export function publicCommentary(value: unknown, calls: readonly LlmToolCall[] = []): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text || /[<>\u0000-\u001f]|DSML|reasoning_content|tool_calls|productId|citationIds|api[_ -]?key|authorization|https?:\/\/|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/iu.test(text)) return undefined;
  if (calls.some(call => text.includes(call.name) || Object.entries(call.arguments).some(([key, value]) => /id$|key|token|secret|authorization/iu.test(key) && typeof value === 'string' && value.length >= 4 && text.includes(value)))) return undefined;
  return text;
}

/** Only standard tool_calls can execute tools. Content has one JSON contract. */
export function parseAgentResponse(content: string, toolCalls: readonly LlmToolCall[] = []): AgentModelResponse {
  if (toolCalls.length) {
    const calls = z.array(nativeCall).safeParse(toolCalls);
    if (!calls.success || new Set(calls.data.map(call => call.id)).size !== calls.data.length) throw new AgentProtocolError('invalid_native_tool_calls');
    let commentary: string | undefined;
    try {
      const body: unknown = JSON.parse(content);
      if (body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).every(key => key === 'commentary')) {
        commentary = publicCommentary((body as { commentary?: unknown }).commentary, calls.data);
      }
    } catch { /* Optional copy; no protocol fallback and no extra model request. */ }
    return { mode: 'native', calls: calls.data, ...(commentary ? { commentary } : {}) };
  }
  let body: unknown;
  try { body = JSON.parse(content); } catch { throw new AgentProtocolError('invalid_final_json'); }
  const final = finalResponse.safeParse(body);
  if (!final.success) throw new AgentProtocolError('invalid_final_format');
  return { mode: 'final', final: final.data };
}
