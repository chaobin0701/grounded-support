import { Controller, DefaultValuePipe, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Body, Query, Req, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../admin/admin-auth.guard';
import { AdminRequest } from '../admin/admin.types';
import { PermissionGuard } from '../admin/permission.guard';
import { RequirePermission } from '../admin/permission.decorator';
import { AdminDebugService } from './admin-debug.service';
import { CreateDebugCaseDto, InspectConversationDebugDto, UpdateDebugCaseStatusDto } from './admin-debug.dto';

@Controller('admin/debug')
@UseGuards(AdminAuthGuard, PermissionGuard)
@RequirePermission('conversations.debug')
export class AdminDebugController {
  constructor(private readonly debug: AdminDebugService) {}

  @Post('inspect')
  inspect(@Req() request: AdminRequest, @Body() body: InspectConversationDebugDto) {
    return this.debug.inspect(request.admin!.id, body);
  }

  @Post('cases')
  createCase(@Req() request: AdminRequest, @Body() body: CreateDebugCaseDto) {
    return this.debug.createCase(request.admin!.id, body);
  }

  @Get('cases')
  listCases(@Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number) {
    return this.debug.listCases(limit);
  }

  @Get('cases/:id')
  getCase(@Req() request: AdminRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.debug.getCase(request.admin!.id, id);
  }

  @Patch('cases/:id/status')
  updateStatus(@Req() request: AdminRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateDebugCaseStatusDto) {
    return this.debug.updateStatus(request.admin!.id, id, body.status);
  }
}
