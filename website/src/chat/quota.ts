import type { ChatStatus, WebsiteQuota } from "./types.ts";
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object";
const counter = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const date = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
export function isWebsiteQuota(value: unknown): value is WebsiteQuota {
  return record(value) && value.scope === "website-shared" && value.timezone === "Asia/Shanghai"
    && date(value.startAt) && date(value.resetAt) && date(value.checkedAt)
    && ["requests", "requestLimit", "remainingRequests", "totalTokens", "reservedTokens", "unknownModelCalls"].every((key) => counter(value[key]))
    && Number(value.requestLimit) > 0
    && (value.tokenLimit === null ? value.remainingTokens === null
      : counter(value.tokenLimit) && value.tokenLimit > 0 && counter(value.remainingTokens));
}
export function isChatStatus(value: unknown): value is ChatStatus {
  return record(value) && value.service === "ready" && typeof value.canSend === "boolean"
    && typeof value.code === "string" && date(value.checkedAt)
    && (value.retryAt === null || date(value.retryAt)) && value.modelHealth === "not_probed";
}
export function quotaPercent(used: number, reserved: number, limit: number | null) {
  if (limit === null || limit <= 0) return null;
  return Math.min(100, Math.max(0, (used + reserved) / limit * 100));
}
export function quotaStatusText(status: ChatStatus | null) {
  if (!status) return "";
  const messages: Record<string, string> = {
    daily_request_quota_exceeded: "今日共享次数已用完",
    daily_token_quota_exceeded: "今日共享 Token 已用完",
    daily_token_budget_insufficient: "剩余额度不足以继续本次回答",
    token_budget_reserved: "额度暂被其他请求占用",
    concurrency_limit: "服务繁忙，请稍后再试",
    request_rate_limit: "请求较频繁，请稍后再试",
    access_denied: "当前服务不可用",
  };
  return status.canSend ? "" : messages[status.code] || "暂时无法发送，请稍后再试";
}
