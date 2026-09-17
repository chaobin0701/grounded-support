import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../database.service';
import { adminRoles, rolePermissions } from '../db/schema';
import { AdminRequest } from './admin.types';
import { PERMISSION_KEY } from './permission.decorator';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly database: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string>(PERMISSION_KEY, [
      context.getHandler(), context.getClass(),
    ]);
    if (!required) return true;

    const adminId = context.switchToHttp().getRequest<AdminRequest>().admin?.id;
    if (!adminId) throw new ForbiddenException();

    const granted = await this.database.db
      .select({ roleId: adminRoles.roleId })
      .from(adminRoles)
      .innerJoin(rolePermissions, eq(adminRoles.roleId, rolePermissions.roleId))
      .where(and(eq(adminRoles.adminId, adminId), eq(rolePermissions.permissionCode, required)))
      .limit(1);
    if (granted.length === 0) throw new ForbiddenException('Permission denied');
    return true;
  }
}
