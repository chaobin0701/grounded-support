import { Controller, Get, UseGuards } from '@nestjs/common';
import { DatabaseService } from '../database.service';
import { AdminAuthGuard } from './admin-auth.guard';
import { PermissionGuard } from './permission.guard';
import { RequirePermission } from './permission.decorator';

type ProductRow = {
  id: string;
  brand: string;
  name: string;
  categoryId: string;
  category: string;
  summary: string;
  description: string;
  suggestedPrice: string | null;
  imageUrl: string | null;
  sourceUrl: string | null;
  specifications: Record<string, string>;
  displayOrder: number;
  enabled: boolean;
  updatedAt: string;
};

@Controller('admin/products')
@UseGuards(AdminAuthGuard, PermissionGuard)
export class AdminProductController {
  constructor(private readonly database: DatabaseService) {}

  @Get()
  @RequirePermission('knowledge_bases.manage')
  async list(): Promise<ProductRow[]> {
    const result = await this.database.query<ProductRow>(`
      SELECT id, brand, name, category_id AS "categoryId", category_name AS category,
             summary, description, suggested_price AS "suggestedPrice",
             image_url AS "imageUrl", source_url AS "sourceUrl", specifications,
             display_order AS "displayOrder", enabled,
             updated_at AS "updatedAt"
      FROM catalog_products
      ORDER BY display_order, name
    `);
    return result.rows;
  }
}
