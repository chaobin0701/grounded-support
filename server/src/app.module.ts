import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { DocumentModule } from './documents/document.module';
import { HealthController } from './health.controller';

@Module({
  imports: [AdminModule, DocumentModule],
  controllers: [HealthController],
})
export class AppModule {}
