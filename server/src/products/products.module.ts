import { Module } from '@nestjs/common';
import { ToolsModule } from '../ai/tools/tools.module';
import { ProductsController } from './products.controller';

@Module({
  imports: [ToolsModule],
  controllers: [ProductsController],
})
export class ProductsModule {}
