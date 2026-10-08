import { HttpException } from '@nestjs/common';

export function quotaExceeded(code: string, message: string, retryAt: string): HttpException {
  return new HttpException({ statusCode: 429, code, message, retryAt }, 429);
}
export function publicIntegrationError(error: unknown) {
  const status = error instanceof HttpException ? error.getStatus() : 503;
  const body = error instanceof HttpException ? error.getResponse() : null;
  if (status === 502 && body && typeof body === 'object' && 'code' in body && body.code === 'model_protocol_error') return { status, code: 'model_protocol_error', message: '模型响应格式异常，本轮未完成，请稍后重试。' };
  if (status === 429 && body && typeof body === 'object' && 'code' in body && typeof body.code === 'string' && 'retryAt' in body && typeof body.retryAt === 'string') {
    return { status, code: body.code, retryAt: body.retryAt, message: 'message' in body && typeof body.message === 'string' ? body.message : '当前访问较多，请稍后重试。' };
  }
  return { status, message: status === 429 ? '当前访问较多，请稍后重试。' : '回答暂时未能完成，请使用新的请求 ID 重试。' };
}
