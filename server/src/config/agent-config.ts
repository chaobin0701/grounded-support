import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);
export const agentConfigurationSchema = z.object({
  version: z.literal(1),
  identity: z.object({ name: text(80), role: text(200), persona: text(8000) }).strict(),
  answeringInstructions: text(12000),
  responseStyle: z.object({ tone: z.enum(['professional', 'friendly', 'concise']), detail: z.enum(['brief', 'balanced', 'detailed']) }).strict(),
  enabledSkills: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,79}$/u)).max(30).refine(ids => new Set(ids).size === ids.length, 'Duplicate Skill IDs'),
  runtime: z.object({
    allowedTools: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,79}$/u)).max(30),
    maxToolCalls: z.number().int().min(1).max(20),
    maxPlannerRounds: z.number().int().min(2).max(30),
    toolTimeoutMs: z.number().int().min(1000).max(120000),
    maxToolResultChars: z.number().int().min(1000).max(50000),
  }).strict().superRefine((runtime, ctx) => {
    if (new Set(runtime.allowedTools).size !== runtime.allowedTools.length) {
      ctx.addIssue({ code: 'custom', path: ['allowedTools'], message: 'Duplicate tool names' });
    }
    if (runtime.maxPlannerRounds <= runtime.maxToolCalls) {
      ctx.addIssue({ code: 'custom', path: ['maxPlannerRounds'], message: 'Reserve a round for final response' });
    }
  }),
  memory: z.object({
    recentTurns: z.number().int().min(1).max(20),
    snapshotTurns: z.number().int().min(1).max(50),
    transcriptMaxMessages: z.number().int().min(10).max(500),
    transcriptMaxTraces: z.number().int().min(1).max(100),
    summaryTriggerTurns: z.number().int().min(2).max(50),
    summaryKeepRecentTurns: z.number().int().min(1).max(20),
    summaryMaxChars: z.number().int().min(100).max(5000),
    summaryBatchMaxMessages: z.number().int().min(4).max(200),
    summaryInstructions: text(8000),
  }).strict().superRefine((memory, ctx) => {
    if (memory.summaryKeepRecentTurns >= memory.summaryTriggerTurns) {
      ctx.addIssue({ code: 'custom', path: ['summaryKeepRecentTurns'], message: 'Must be less than summaryTriggerTurns' });
    }
    if (memory.snapshotTurns < memory.recentTurns) {
      ctx.addIssue({ code: 'custom', path: ['snapshotTurns'], message: 'Must cover recentTurns' });
    }
    if (memory.summaryBatchMaxMessages < memory.summaryTriggerTurns * 2) {
      ctx.addIssue({ code: 'custom', path: ['summaryBatchMaxMessages'], message: 'Must cover summaryTriggerTurns' });
    }
  }),
  welcome: z.object({
    title: text(200), description: text(500),
    suggestedQuestions: z.array(z.string().trim().min(2).max(200)).min(1).max(6),
  }).strict(),
  answerInstructions: text(8000),
}).strict();

export type AgentConfiguration = z.infer<typeof agentConfigurationSchema>;
export type AgentRuntimeConfiguration = AgentConfiguration['runtime'];
export type AgentConfigurationSnapshot = { configuration: AgentConfiguration; revision: string; configurationVersion: number; updatedAt: string | null; updatedBy: number | null };
export const agentEditableSchema = agentConfigurationSchema.omit({ version: true, answerInstructions: true });
export type AgentEditableConfiguration = z.infer<typeof agentEditableSchema>;

export function effectiveAgentConfiguration(configuration: AgentConfiguration): AgentConfiguration {
  if (configuration.enabledSkills.length) return configuration;
  return parseAgentConfiguration({ ...configuration, runtime: { ...configuration.runtime, allowedTools: configuration.runtime.allowedTools.filter(name => name !== 'load_skill') } });
}

export function parseAgentConfiguration(value: unknown): AgentConfiguration {
  const parsed = agentConfigurationSchema.safeParse(value);
  if (!parsed.success) {
    // Report field names only, never include configuration contents in logs.
    throw new Error(`Invalid Agent configuration: ${parsed.error.issues.map(issue => issue.path.join('.')).join(', ')}`);
  }
  return deepFreeze(parsed.data);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

// Node's watch mode tracks this JSON dependency, so local edits restart the API.
export const DEFAULT_AGENT_CONFIGURATION = parseAgentConfiguration(require('../../config/agent.json'));

export function readAgentConfiguration(filePath = process.env.AGENT_CONFIG_PATH?.trim()): AgentConfiguration {
  if (!filePath) return DEFAULT_AGENT_CONFIGURATION;
  let value: unknown;
  try { value = JSON.parse(readFileSync(resolve(filePath), 'utf8')); }
  catch { throw new Error('Cannot read Agent configuration: AGENT_CONFIG_PATH'); }
  return parseAgentConfiguration(value);
}

export function agentConfigurationRevision(config: AgentConfiguration): string {
  return createHash('sha256').update(JSON.stringify(config)).digest('hex').slice(0, 12);
}
