import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { DocumentController } from './document.controller';
import { DocumentQueueService } from './document-queue.service';
import { DocumentService } from './document.service';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [AdminModule],
  controllers: [DocumentController, SearchController],
  providers: [DocumentQueueService, DocumentService, SearchService],
})
export class DocumentModule {}
