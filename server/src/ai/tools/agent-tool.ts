import { z } from 'zod';
import { ToolContext } from './tool-context';
import { ToolResult } from './tool-result';

export type AgentToolPlanning = {
  /** Whether this tool can share a planner response with other independent reads. */
  readonly canBatch: boolean;
  /** Human-readable dependency hint for the planner; execution still validates inputs. */
  readonly dependency?: string;
};

/** A business capability that an agent may execute by name. */
export interface AgentTool<TInput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodTypeAny;
  readonly planning?: AgentToolPlanning;

  execute(input: TInput, context: ToolContext): Promise<ToolResult>;
}
