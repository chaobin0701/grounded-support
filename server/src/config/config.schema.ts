import { z } from 'zod';

const DEFAULT_LLM_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
const DEFAULT_LLM_MODEL = 'deepseek-v4-1-flash-260910';
const DEFAULT_LLM_TIMEOUT_MS = 20_000;

export const configSchema = z.object({
  port: z.coerce.number().int().min(1).max(65_535).default(3000),
  llm: z.object({
    provider: z.enum(['openai-compatible']).default('openai-compatible'),
    apiKey: z.string().default(''),
    baseUrl: z.string().url().default(DEFAULT_LLM_BASE_URL),
    model: z.string().trim().min(1).default(DEFAULT_LLM_MODEL),
    timeoutMs: z.coerce.number().int().min(1_000).max(120_000).default(DEFAULT_LLM_TIMEOUT_MS),
  }).default({
    provider: 'openai-compatible',
    apiKey: '',
    baseUrl: DEFAULT_LLM_BASE_URL,
    model: DEFAULT_LLM_MODEL,
    timeoutMs: DEFAULT_LLM_TIMEOUT_MS,
  }),
});

export type AppConfig = z.infer<typeof configSchema>;
export type LlmConfig = AppConfig['llm'];

export function readConfigEnvironment(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.safeParse({
    port: env.PORT,
    llm: {
      provider: env.LLM_PROVIDER,
      apiKey: env.LLM_API_KEY?.trim(),
      baseUrl: env.LLM_BASE_URL?.trim(),
      model: env.LLM_MODEL?.trim(),
      timeoutMs: env.LLM_TIMEOUT_MS,
    },
  });
  if (!parsed.success) {
    const names: Record<string, string> = {
      port: 'PORT',
      'llm.provider': 'LLM_PROVIDER',
      'llm.apiKey': 'LLM_API_KEY',
      'llm.baseUrl': 'LLM_BASE_URL',
      'llm.model': 'LLM_MODEL',
      'llm.timeoutMs': 'LLM_TIMEOUT_MS',
    };
    const details = parsed.error.issues
      .map((issue) => `${names[issue.path.join('.')] ?? (issue.path.join('.') || 'config')} ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid configuration: ${details}`);
  }
  return parsed.data;
}
