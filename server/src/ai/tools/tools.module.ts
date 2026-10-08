import { Module, OnModuleInit } from '@nestjs/common';
import { AdminModule } from '../../admin/admin.module';
import { DocumentModule } from '../../documents/document.module';
import { AgentTool } from './agent-tool';
import { KnowledgeSearchTool } from './knowledge-search.tool';
import { ProductCategoryTool } from './product-catalog/product-category.tool';
import { ProductDetailTool } from './product-catalog/product-detail.tool';
import { ProductListTool } from './product-catalog/product-list.tool';
import { ProductCatalogService } from './product-catalog/product-catalog.service';
import { ToolExecutionService } from './tool-execution';
import { ToolPolicy } from './tool-policy';
import { ToolRegistry } from './tool-registry';
import { SkillsModule } from '../skills/skills.module';
import { LoadSkillTool } from './load-skill.tool';

@Module({
  imports: [DocumentModule, AdminModule, SkillsModule],
  providers: [
    ProductCatalogService,
    ProductCategoryTool,
    ProductListTool,
    ProductDetailTool,
    KnowledgeSearchTool,
    LoadSkillTool,
    ToolPolicy,
    ToolExecutionService,
    ToolRegistry,
  ],
  exports: [ToolRegistry, ToolExecutionService, ProductCatalogService],
})
export class ToolsModule implements OnModuleInit {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly knowledgeSearch: KnowledgeSearchTool,
    private readonly productCategory: ProductCategoryTool,
    private readonly productList: ProductListTool,
    private readonly productDetail: ProductDetailTool,
    private readonly loadSkill: LoadSkillTool,
  ) {}

  onModuleInit(): void {
    const tools: AgentTool[] = [this.knowledgeSearch, this.productCategory, this.productList, this.productDetail, this.loadSkill];
    for (const tool of tools) this.registry.register(tool);
  }
}
