import { HttpException, HttpStatus } from '@nestjs/common';

export type ErrorResponse = { error: { code: string; message: string; retryAt?: string }; requestId: string };

export function normalizeError(exception: unknown, requestId: string): { status: number; body: ErrorResponse } {
  const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
  const response = exception instanceof HttpException ? exception.getResponse() : undefined;
  const rawMessage = typeof response === 'string'
    ? response
    : response && typeof response === 'object' && 'message' in response
      ? (response as { message?: unknown }).message
      : undefined;
  const message = status >= 500 ? '服务暂时不可用，请稍后重试。' : Array.isArray(rawMessage) ? rawMessage.join('; ') : typeof rawMessage === 'string' ? rawMessage : '请求无法处理';
  const code = response && typeof response === 'object' && 'code' in response && typeof (response as { code?: unknown }).code === 'string'
    ? (response as { code: string }).code
    : status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : status === 429 ? 'rate_limit_exceeded' : status >= 500 ? 'internal_error' : 'bad_request';
  const rawRetryAt = status === 429 && response && typeof response === 'object' && 'retryAt' in response ? response.retryAt : undefined;
  const retryAt = typeof rawRetryAt === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.+-]+Z?$/.test(rawRetryAt) && Number.isFinite(Date.parse(rawRetryAt)) ? new Date(rawRetryAt).toISOString() : undefined;
  return { status, body: { error: { code, message, ...(retryAt ? { retryAt } : {}) }, requestId } };
}
