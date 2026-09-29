import type { SearchHit } from '../../documents/fuse-search-results';
import type { ProductDetail, ProductSummary } from '../tools/product-catalog/product-catalog.service';
import type { ToolContext } from '../tools/tool-context';
import type { ToolExecutionTrace } from '../tools/tool-execution';
import type { ToolExecutionState } from '../tools/tool-policy';
import type { SkillDefinition } from '../skills/skill.types';
import type { AgentTranscriptMessage } from '../../chat/agent-transcript';
import type { ContextBudget } from '../../chat/context-governor';

export type AgentModelCall = {
  id: string;
  purpose: 'planner' | 'answer' | 'summary';
  plannerRound?: number;
  model: string;
  request: {
    messages: Array<{ role: string; content: string }>;
    temperature: number;
    maxTokens: number;
  };
  response: {
    content: string;
    finishReason: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  };
  durationMs: number;
  attempts: number;
  contextBudget?: ContextBudget;
};

export type AgentExecutionStep = {
  type: 'skill_selection' | 'preflight' | 'llm_call' | 'tool_call' | 'validation';
  stage: 'planning' | 'final_answer' | 'tool' | 'answer_guard';
  skillId?: string;
  selectedBy?: string;
  query?: string | null;
  hitCount?: number;
  retrievalMode?: string;
  name?: string;
  model?: string;
  ok: boolean;
  durationMs: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  finishReason?: string | null;
  attempts?: number;
  arguments?: Record<string, unknown>;
  result?: unknown;
  errorCode?: string;
  detail?: string;
  plannerRound?: number;
  toolBatchId?: string;
  toolIndex?: number;
};

export type AgentState = {
  toolContext: ToolContext;
  executionState: ToolExecutionState;
  toolCalls: ToolExecutionTrace[];
  toolResults: Array<Record<string, unknown>>;
  executionSteps: AgentExecutionStep[];
  modelCalls: AgentModelCall[];
  hits: Map<number, SearchHit>;
  products: Map<string, ProductSummary | ProductDetail>;
  contextSnapshot: Record<string, unknown>;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  usageSeen: boolean;
  finalRaw: string;
  skill: SkillDefinition;
  plannerRound: number;
  transcript: AgentTranscriptMessage[];
  traceTranscript: AgentTranscriptMessage[];
};
