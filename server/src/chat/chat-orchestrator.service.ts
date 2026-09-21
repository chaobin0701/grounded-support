import { Injectable } from '@nestjs/common';
import { AgentRunner } from '../ai/agent/agent-runner';
import type { PreviousTurnDto } from './chat.dto';
import type { ChatRun, CommentaryEvent, ToolStep } from './chat.service';

export { validateAgentAnswer } from '../ai/agent/agent-answer';

@Injectable()
export class ChatOrchestratorService {
  constructor(private readonly agentRunner: AgentRunner) {}

  async askDetailed(
    question: string,
    history: PreviousTurnDto[],
    summary: string,
    onContext?: (context: Record<string, unknown>) => void,
    _onStep?: (step: ToolStep) => void,
    _onCommentary?: (event: CommentaryEvent) => void,
  ): Promise<ChatRun> {
    const result = await this.agentRunner.run(
      { question, summary, recentHistory: history },
      { onContext },
    );
    return {
      result: result.result,
      contextSnapshot: result.contextSnapshot,
      rawModelOutput: result.rawModelOutput,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      totalTokens: result.totalTokens,
    };
  }
}
