export type LlmProfileRecord = {
  id: number;
  name: string;
  providerKey: 'openai-compatible';
  adapterType: 'openai-compatible';
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs: number;
  contextWindowTokens: number;
  maxOutputTokens: number;
  structuredOutput: 'auto' | 'required' | 'disabled';
  supportsToolCalls: boolean;
  supportsStreaming: boolean;
  enabled: boolean;
  isDefault: boolean;
};

export type LlmProfileView = Omit<LlmProfileRecord, 'apiKey'> & { hasApiKey: boolean };
