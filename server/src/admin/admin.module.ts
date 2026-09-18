import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminAuthService } from './admin-auth.service';
import { AdminManagementController } from './admin-management.controller';
import { AdminManagementService } from './admin-management.service';
import { PermissionGuard } from './permission.guard';
import { DatabaseService } from '../database.service';
import { McpCapabilityAdminController } from '../mcp/mcp-capability-admin.controller';
import { McpCapabilityAdminService } from '../mcp/mcp-capability-admin.service';

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('JWT_SECRET must be at least 32 bytes');
  }
  return secret;
}

@Module({
  imports: [JwtModule.register({ secret: jwtSecret(), signOptions: { expiresIn: '15m' } })],
  controllers: [AdminAuthController, AdminManagementController, McpCapabilityAdminController],
  providers: [DatabaseService, AdminAuthService, AdminManagementService, McpCapabilityAdminService, AdminAuthGuard, PermissionGuard],
  exports: [JwtModule, DatabaseService, AdminAuthGuard, PermissionGuard],
})
export class AdminModule {}
