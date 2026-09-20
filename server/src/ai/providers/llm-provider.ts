import { LlmRequest, LlmResponse } from './provider.types';

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

export interface LlmProvider {
  readonly model: string;
  chat(request: LlmRequest): Promise<LlmResponse>;
}
