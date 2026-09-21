import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { ChatModule } from './chat/chat.module';
import { ConfigModule } from './config/config.module';
import { DocumentModule } from './documents/document.module';
import { HealthController } from './health.controller';

@Module({
  imports: [ConfigModule, AdminModule, DocumentModule, ChatModule],
  controllers: [HealthController],
})
export class AppModule {}
