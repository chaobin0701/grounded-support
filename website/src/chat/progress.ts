import type { ProgressEvent } from "./types.ts";
export interface ProgressStep extends ProgressEvent {
  key: string;
  label: string;
  stateLabel: string;
}
export function progressSteps(
  events: ProgressEvent[],
  settled = false,
): ProgressStep[] {
  const steps = new Map<string, ProgressStep>();
  for (const event of events) {
    if (event.stage !== "tool" && event.stage !== "answer") continue;
    const key =
      event.operationId ||
      (event.stage === "answer"
        ? "answer"
        : `${event.stage}:${event.tool || event.id.replace(/-(start|end)$/u, "")}`);
    steps.set(key, {
      ...steps.get(key),
      ...event,
      key,
      text: event.text.replace(/[.…]+$/u, ""),
      label: event.stage === "tool" ? "资料查询" : "回答整理",
      stateLabel:
        event.status === "completed" ? "已完成" : settled ? "未完成" : "进行中",
    });
  }
  return [...steps.values()];
}
export function duration(ms?: number) {
  return ms === undefined || ms < 1
    ? ""
    : ms < 1000
      ? `${ms} ms`
      : `${(ms / 1000).toFixed(1)} s`;
}
