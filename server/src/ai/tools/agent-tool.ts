import { z } from 'zod';
import { ToolContext } from './tool-context';
import { ToolResult } from './tool-result';
import type { ContextProjector } from '../context/context-contribution';
import type { AgentToolCapability } from './tool-capabilities';

export type AgentToolPlanning = {
  /** Independent reads can share a response. A successful false tool requires replanning before subsequent calls. */
  readonly canBatch: boolean;
  /** Human-readable dependency hint for the planner; execution still validates inputs. */
  readonly dependency?: string;
};

/** A business capability that an agent may execute by name. */
export interface AgentTool<TInput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodTypeAny;
  /** Stable business capability; adapter-specific tool names stay at the edge. */
  readonly capabilities?: readonly AgentToolCapability[];
  readonly planning?: AgentToolPlanning;
  /** Trusted opt-in projection of safe result fields into persistent model context. */
  readonly contributeContext?: ContextProjector;

  execute(input: TInput, context: ToolContext): Promise<ToolResult>;
}
