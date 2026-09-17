import { Module } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
  providers: [DatabaseService],
})
export class AppModule {}
