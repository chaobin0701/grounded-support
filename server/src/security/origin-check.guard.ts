import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/config.service';

@Injectable()
export class OriginCheckGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ method: string; headers: { origin?: string } }>();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return true;
    const origin = request.headers.origin;
    if (!origin || this.config.security.allowedOrigins.length === 0) return true;
    if (!this.config.security.allowedOrigins.includes(origin)) throw new ForbiddenException('Origin is not allowed');
    return true;
  }
}
