import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

export interface SecurityRequest extends Request {
  requestId?: string;
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(request: SecurityRequest, _response: Response, next: NextFunction): void {
    request.requestId = randomUUID();
    next();
  }
}
