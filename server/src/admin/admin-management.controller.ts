import { Body, Controller, DefaultValuePipe, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminManagementService } from './admin-management.service';
import { AdminRequest } from './admin.types';
import { CreateAdminDto } from './auth.dto';
import { AssignRolesDto, CreateRoleDto, SetAdminStatusDto, UpdateRoleDto } from './management.dto';
import { RequirePermission } from './permission.decorator';
import { PermissionGuard } from './permission.guard';

@Controller('admin')
@UseGuards(AdminAuthGuard, PermissionGuard)
export class AdminManagementController {
  constructor(private readonly management: AdminManagementService) {}

  @Get('permissions')
  @RequirePermission('roles.manage')
  listPermissions() {
    return this.management.listPermissions();
  }

  @Get('roles')
  @RequirePermission('roles.manage')
  listRoles() {
    return this.management.listRoles();
  }

  @Post('roles')
  @RequirePermission('roles.manage')
  createRole(@Req() request: AdminRequest, @Body() body: CreateRoleDto) {
    return this.management.createRole(request.admin!.id, body);
  }

  @Patch('roles/:id')
  @RequirePermission('roles.manage')
  updateRole(@Req() request: AdminRequest, @Param('id', ParseIntPipe) id: number, @Body() body: UpdateRoleDto) {
    return this.management.updateRole(request.admin!.id, id, body);
  }

  @Get('admins')
  @RequirePermission('admins.manage')
  listAdmins() {
    return this.management.listAdmins();
  }

  @Post('admins')
  @RequirePermission('admins.manage')
  createAdmin(@Req() request: AdminRequest, @Body() body: CreateAdminDto) {
    return this.management.createAdmin(request.admin!.id, body);
  }

  @Patch('admins/:id/roles')
  @RequirePermission('admins.manage')
  assignRoles(@Req() request: AdminRequest, @Param('id', ParseIntPipe) id: number, @Body() body: AssignRolesDto) {
    return this.management.assignRoles(request.admin!.id, id, body);
  }

  @Patch('admins/:id/status')
  @RequirePermission('admins.manage')
  setStatus(@Req() request: AdminRequest, @Param('id', ParseIntPipe) id: number, @Body() body: SetAdminStatusDto) {
    return this.management.setStatus(request.admin!.id, id, body.disabled);
  }

  @Get('audit')
  @RequirePermission('audit.read')
  listAudit(@Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number) {
    return this.management.listAudit(Math.max(1, Math.min(limit, 100)));
  }
}
