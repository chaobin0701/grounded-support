import { Injectable } from '@nestjs/common';
import { PreviousTurnDto } from './chat.dto';

export interface ContextBuildInput {
  question: string;
  summary: string;
  recentHistory: PreviousTurnDto[];
  toolResults: Array<Record<string, unknown>>;
}

export interface BuiltContext {
  question: string;
  summary: string;
  history: PreviousTurnDto[];
  userPrompt: string;
  metadata: {
    summaryIncluded: boolean;
    historyCount: number;
    toolResultCount: number;
    truncated: boolean;
  };
}

@Injectable()
export class ContextBuilder {
  build(input: ContextBuildInput): BuiltContext {
    const question = input.question.trim().slice(0, 200);
    const summary = input.summary.slice(0, 1500);
    const history = input.recentHistory.slice(-3).map((turn) => ({
      question: turn.question.trim().slice(0, 200),
      answer: turn.answer.trim().slice(0, 1200),
    }));
    const payload = {
      question,
      summary,
      history,
      toolResults: input.toolResults,
    };
    const userPrompt = JSON.stringify(payload);
    return {
      question,
      summary,
      history,
      userPrompt,
      metadata: {
        summaryIncluded: Boolean(summary),
        historyCount: history.length,
        toolResultCount: input.toolResults.length,
        truncated: question !== input.question.trim()
          || summary !== input.summary
          || history.length !== input.recentHistory.length,
      },
    };
  }
}
