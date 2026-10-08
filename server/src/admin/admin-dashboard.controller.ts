import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminAuthService } from './admin-auth.service';
import { AdminDashboardService } from './admin-dashboard.service';
import type { AdminRequest } from './admin.types';
import { PermissionGuard } from './permission.guard';
import { RequirePermission } from './permission.decorator';

@Controller('admin/dashboard')
@UseGuards(AdminAuthGuard, PermissionGuard)
export class AdminDashboardController {
  constructor(private readonly dashboard: AdminDashboardService, private readonly auth: AdminAuthService) {}

  @Get()
  @RequirePermission('conversations.read', 'documents.read', 'knowledge_bases.manage')
  async overview(@Req() request: AdminRequest, @Query('range') range: unknown = '7d') {
    const identity = await this.auth.me(request.admin!);
    return this.dashboard.overview(range, identity.permissionCodes);
  }
}
