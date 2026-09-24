import { Injectable, Optional } from '@nestjs/common';
import { AgentRunner } from '../ai/agent/agent-runner';
import type { PreviousTurnDto } from './chat.dto';
import type { ChatRun, CommentaryEvent, ToolStep } from './chat.service';
import { SkillSelector } from '../ai/skills/skill-selector';
import { questionAnsweringSkill } from '../ai/skills/built-in/question-answering.skill';
import { SkillPreflightService } from '../ai/skills/skill-preflight.service';

export { validateAgentAnswer } from '../ai/agent/agent-answer';

@Injectable()
export class ChatOrchestratorService {
  constructor(
    private readonly agentRunner: AgentRunner,
    private readonly skillSelector?: SkillSelector,
    @Optional() private readonly skillPreflight?: SkillPreflightService,
  ) {}

  async askDetailed(
    question: string,
    history: PreviousTurnDto[],
    summary: string,
    onContext?: (context: Record<string, unknown>) => void,
    _onStep?: (step: ToolStep) => void,
    _onCommentary?: (event: CommentaryEvent) => void,
    requestedSkillId?: string,
  ): Promise<ChatRun> {
    const selected = this.skillSelector
      ? this.skillSelector.select(question, requestedSkillId)
      : { skill: questionAnsweringSkill, selectedBy: 'default' as const };
    const preflight = this.skillPreflight
      ? await this.skillPreflight.run(question, selected.skill)
      : { hits: [], query: null, durationMs: 0 };
    const result = await this.agentRunner.run(
      {
        question,
        summary,
        recentHistory: history,
        skill: selected.skill,
        initialEvidence: preflight.hits,
        preflight: {
          query: preflight.query,
          durationMs: preflight.durationMs,
          hitCount: preflight.hits.length,
          ...(preflight.retrievalMode ? { retrievalMode: preflight.retrievalMode } : {}),
          ...(preflight.errorCode ? { errorCode: preflight.errorCode } : {}),
        },
        selectedBy: selected.selectedBy,
      },
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
