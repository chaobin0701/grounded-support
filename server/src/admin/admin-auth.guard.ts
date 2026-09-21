import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../database.service';
import { admins } from '../db/schema';
import { AdminRequest } from './admin.types';
import { AppConfigService } from '../config/config.service';

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly database: DatabaseService, private readonly config: AppConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const token = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? '')?.[1];
    if (!token) throw new UnauthorizedException('Authentication is required');

    let subject: string;
    try {
      const claims = await this.jwt.verifyAsync<{ sub: string }>(token, {
        issuer: this.config.jwt.issuer,
        audience: this.config.jwt.audience,
      });
      subject = claims.sub;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const adminId = Number(subject);
    if (!Number.isSafeInteger(adminId) || adminId <= 0) {
      throw new UnauthorizedException('Invalid token subject');
    }

    const [admin] = await this.database.db
      .select({ id: admins.id, email: admins.email, displayName: admins.displayName, disabledAt: admins.disabledAt })
      .from(admins)
      .where(eq(admins.id, adminId))
      .limit(1);

    if (!admin || admin.disabledAt) throw new UnauthorizedException('Administrator is unavailable');
    request.admin = { id: admin.id, email: admin.email, displayName: admin.displayName };
    return true;
  }
}
