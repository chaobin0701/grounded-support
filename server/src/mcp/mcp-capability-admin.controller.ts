import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { AdminAuthGuard } from '../admin/admin-auth.guard';
import { AdminRequest } from '../admin/admin.types';
import { RequirePermission } from '../admin/permission.decorator';
import { PermissionGuard } from '../admin/permission.guard';
import { McpCapabilityAdminService } from './mcp-capability-admin.service';

class SetEnabledDto {
  @IsBoolean()
  enabled!: boolean;
}

@Controller('admin/mcp/capabilities')
@UseGuards(AdminAuthGuard, PermissionGuard)
export class McpCapabilityAdminController {
  constructor(private readonly capabilities: McpCapabilityAdminService) {}

  @Get()
  @RequirePermission('mcp.read', 'mcp.manage')
  list() {
    return this.capabilities.list();
  }

  @Patch(':id')
  @RequirePermission('mcp.manage')
  setCapability(@Req() request: AdminRequest, @Param('id') id: string, @Body() body: SetEnabledDto) {
    return this.capabilities.setCapability(request.admin!.id, id, body.enabled);
  }

  @Patch(':id/tools/:name')
  @RequirePermission('mcp.manage')
  setTool(@Req() request: AdminRequest, @Param('id') id: string, @Param('name') name: string, @Body() body: SetEnabledDto) {
    return this.capabilities.setTool(request.admin!.id, id, name, body.enabled);
  }
}
