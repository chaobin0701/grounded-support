import { Injectable } from '@nestjs/common';
import { AgentTool } from './agent-tool';
import { DuplicateToolError, UnknownToolError } from './tool-errors';

@Injectable()
export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>();

  register(tool: AgentTool): void {
    if (this.tools.has(tool.name)) throw new DuplicateToolError(tool.name);
    this.tools.set(tool.name, tool);
  }

  get(name: string): AgentTool {
    const tool = this.tools.get(name);
    if (!tool) throw new UnknownToolError(name);
    return tool;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): AgentTool[] {
    return [...this.tools.values()];
  }
}
