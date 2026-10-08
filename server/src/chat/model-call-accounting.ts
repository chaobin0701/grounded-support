import { AsyncLocalStorage } from 'node:async_hooks';
import type { LlmRequest, LlmUsage } from '../ai/providers/provider.types';

export type ModelCallPurpose = 'planner' | 'answer' | 'summary';
export type ModelCallLease = {
  settle: (usage: LlmUsage | null, error?: unknown) => Promise<void>;
};
export type ModelCallAccounting = {
  reserve: (request: LlmRequest, purpose: ModelCallPurpose) => Promise<ModelCallLease>;
};

// Per-request callbacks, not global mutable model settings. Async summaries inherit
// the originating application's accounting without putting storage in AgentLoop.
const accounting = new AsyncLocalStorage<ModelCallAccounting>();
export function withModelCallAccounting<T>(context: ModelCallAccounting, task: () => Promise<T>): Promise<T> {
  return accounting.run(context, task);
}
export async function reserveModelCall(request: LlmRequest, purpose: ModelCallPurpose): Promise<ModelCallLease | undefined> {
  return accounting.getStore()?.reserve(request, purpose);
}

// A conservative UTF-8 bound, not a vendor tokenizer or an invoice estimate.
// Include tool schemas, transcript arguments and framing; never count just the question.
export function modelInputReservation(request: LlmRequest): number {
  return Buffer.byteLength(JSON.stringify({ messages: request.messages, tools: request.tools, responseFormat: request.responseFormat }), 'utf8') + 1024 + request.messages.length * 32;
}
