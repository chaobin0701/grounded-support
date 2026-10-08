import type { CommentaryEvent, ProcessEvent, ProgressEvent } from "./types.ts";
export interface ProgressStep extends ProgressEvent {
  key: string;
  label: string;
  stateLabel: string;
}
export function progressSteps(
  events: ProcessEvent[],
  settled = false,
): ProgressStep[] {
  const steps = new Map<string, ProgressStep>();
  for (const event of events) {
    if (event.type !== "progress") continue;
    if (event.stage !== "tool") continue;
    const key =
      event.operationId ||
      `${event.stage}:${event.tool || event.id.replace(/-(start|end)$/u, "")}`;
    steps.set(key, {
      ...steps.get(key),
      ...event,
      key,
      text: event.text.replace(/[.…]+$/u, ""),
      label: "资料查询",
      stateLabel:
        event.status === "completed" ? "已完成" : settled ? "未完成" : "进行中",
    });
  }
  return [...steps.values()];
}
// Neutral operation names are for the list; raw event text still drives live status.
export function toolLabel(text: string): string {
  return text.replace(/^(?:正在|已)(?=查看|读取|检索|查询|加载|调用)/u, "").replace(/[.…]+$/u, "");
}
// Public progress text is a server-generated operation label, never model reasoning.
export function progressStatus(events: ProcessEvent[], hasAnswer = false): string {
  if (hasAnswer) return "正在生成回答…";
  const answer = [...events].reverse().find(event => event.type === "progress" && event.stage === "answer");
  if (answer?.type === "progress" && answer.status === "running") return answer.text;
  const steps = progressSteps(events);
  const running = [...steps].reverse().find(step => step.status === "running");
  if (running?.text) return `${running.text}…`;
  return steps.length ? "正在继续处理你的问题…" : "正在理解你的问题…";
}
export function commentaryLines(events: ProcessEvent[]): CommentaryEvent[] {
  const lines = new Map<string, CommentaryEvent>();
  for (const event of events) if (event.type === "commentary") lines.set(event.id, event);
  return [...lines.values()];
}
