import { Body,Controller,Delete,Get,Param,ParseIntPipe,Patch,Post,Req,UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../admin/admin-auth.guard';
import { PermissionGuard } from '../admin/permission.guard';
import { RequirePermission } from '../admin/permission.decorator';
import type { AdminRequest } from '../admin/admin.types';
import { EmbeddingProfileService } from './embedding-profile.service';

@Controller('admin/model-profiles/embedding')
@UseGuards(AdminAuthGuard,PermissionGuard)
export class EmbeddingProfileController {
  constructor(private readonly profiles:EmbeddingProfileService) {}
  @Get() @RequirePermission('embedding_profiles.read','embedding_profiles.manage')
  list() { return this.profiles.list(); }
  @Get('metadata') @RequirePermission('embedding_profiles.read','embedding_profiles.manage')
  metadata() { return this.profiles.metadata(); }
  @Post() @RequirePermission('embedding_profiles.manage')
  create(@Req() request:AdminRequest,@Body() input:unknown) { return this.profiles.create(request.admin!.id,input); }
  @Post('test') @RequirePermission('embedding_profiles.manage')
  test(@Req() request:AdminRequest,@Body() input:unknown) { return this.profiles.test(request.admin!.id,input); }
  @Get(':id/usage') @RequirePermission('embedding_profiles.read','embedding_profiles.manage')
  usage(@Param('id',ParseIntPipe) id:number) { return this.profiles.usage(id); }
  @Patch(':id') @RequirePermission('embedding_profiles.manage')
  update(@Req() request:AdminRequest,@Param('id',ParseIntPipe) id:number,@Body() input:unknown) { return this.profiles.update(request.admin!.id,id,input); }
  @Patch(':id/status') @RequirePermission('embedding_profiles.manage')
  status(@Req() request:AdminRequest,@Param('id',ParseIntPipe) id:number,@Body() input:unknown) { return this.profiles.setEnabled(request.admin!.id,id,input); }
  @Delete(':id') @RequirePermission('embedding_profiles.manage')
  remove(@Req() request:AdminRequest,@Param('id',ParseIntPipe) id:number) { return this.profiles.remove(request.admin!.id,id); }
}
