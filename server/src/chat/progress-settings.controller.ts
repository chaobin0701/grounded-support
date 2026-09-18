import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { AdminAuthGuard } from '../admin/admin-auth.guard';
import { AdminRequest } from '../admin/admin.types';
import { RequirePermission } from '../admin/permission.decorator';
import { PermissionGuard } from '../admin/permission.guard';
import { ProgressSettingsService } from './progress-settings.service';

class UpdateProgressSettingsDto {
  @IsBoolean()
  publicProgressEnabled!: boolean;
}

@Controller('admin/chat-settings')
@UseGuards(AdminAuthGuard, PermissionGuard)
export class ProgressSettingsController {
  constructor(private readonly settings: ProgressSettingsService) {}

  @Get()
  @RequirePermission('chat.settings.read', 'chat.settings.manage')
  get() { return this.settings.get(); }

  @Patch()
  @RequirePermission('chat.settings.manage')
  set(@Req() request: AdminRequest, @Body() body: UpdateProgressSettingsDto) {
    return this.settings.set(request.admin!.id, body.publicProgressEnabled);
  }
}
