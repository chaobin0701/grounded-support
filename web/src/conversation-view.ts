import type { ChatTraceDetail, ConversationDetail } from './admin-api';

export function conversationTurns(conversation: ConversationDetail) {
  const messages = [...conversation.messages].sort((a, b) => a.id - b.id);
  const users = messages.filter((message) => message.role === 'user');
  return users.map((user, index) => {
    const run =
      [...conversation.runs]
        .reverse()
        .find((item) => item.userMessageId === user.id) ?? null;
    const trace =
      [...conversation.traces]
        .reverse()
        .find(
          (item) => item.kind === 'answer' && item.userMessageId === user.id,
        ) ?? null;
    const nextUserId = users[index + 1]?.id ?? Infinity;
    const assistant =
      run?.assistantMessageId != null
        ? messages.find(
            (message) =>
              message.role === 'assistant' &&
              message.id === run.assistantMessageId,
          )
        : messages.find(
            (message) =>
              message.role === 'assistant' &&
              message.id > user.id &&
              message.id < nextUserId,
          );
    return { index: index + 1, user, assistant: assistant ?? null, run, trace };
  });
}

export type ConversationTurn = ReturnType<typeof conversationTurns>[number];
export function turnStatus(turn: ConversationTurn) {
  if (turn.run?.status === 'running' || turn.run?.status === 'pending')
    return { text: '处理中', tone: 'active' };
  if (turn.run?.status === 'interrupted')
    return { text: '已中断', tone: 'neutral' };
  if (turn.trace?.status === 'failed' || turn.run?.status === 'failed')
    return { text: '执行失败', tone: 'failed' };
  if (turn.trace?.refused || turn.assistant?.refused)
    return { text: '拒答', tone: 'refused' };
  if (turn.assistant?.content || turn.trace?.finalAnswer)
    return { text: '已回答', tone: 'answered' };
  return { text: turn.trace ? '未生成回答' : '暂无轨迹', tone: 'neutral' };
}

export function formatDuration(ms: number | null | undefined) {
  if (ms == null) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
}

export type TraceStep = NonNullable<
  ChatTraceDetail['contextSnapshot']['executionSteps']
>[number];
export function groupTraceSteps(steps: TraceStep[]) {
  const groups: { label: string; durationMs: number; steps: TraceStep[] }[] =
    [];
  let planningRound = 0;
  for (const step of steps) {
    if (step.type === 'llm_call') {
      planningRound = step.plannerRound ?? planningRound + 1;
      groups.push({
        label:
          step.stage === 'final_answer'
            ? '最终回答生成'
            : `第 ${planningRound} 次模型规划`,
        durationMs: 0,
        steps: [],
      });
    } else if (step.type === 'validation')
      groups.push({ label: '回复格式校验', durationMs: 0, steps: [] });
    if (!groups.length)
      groups.push({ label: '请求准备', durationMs: 0, steps: [] });
    const group = groups[groups.length - 1];
    group.steps.push(step);
    group.durationMs += step.durationMs;
  }
  return groups;
}
