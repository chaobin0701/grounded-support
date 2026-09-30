import { BadRequestException, Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { DatabaseService } from '../database.service';
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminRequest } from './admin.types';
import { ProductDto, UpdateProductDto } from './product.dto';
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

const selectProduct = `
  SELECT id, brand, name, category_id AS "categoryId", category_name AS category,
         summary, description, suggested_price AS "suggestedPrice",
         image_url AS "imageUrl", source_url AS "sourceUrl", specifications,
         display_order AS "displayOrder", enabled, updated_at AS "updatedAt"
  FROM catalog_products
`;

function normalizeSpecifications(value: Record<string, unknown> | undefined): Record<string, string> {
  if (!value) return {};
  const entries = Object.entries(value).map(([key, item]) => [key.trim(), item] as const);
  if (entries.some(([key, item]) => !key || typeof item !== 'string' || !item.trim())) {
    throw new BadRequestException('specifications must contain non-empty string keys and values');
  }
  const normalized: Record<string, string> = {};
  for (const [key, item] of entries) normalized[key] = item as string;
  return normalized;
}

@Controller('admin/products')
@UseGuards(AdminAuthGuard, PermissionGuard)
export class AdminProductController {
  constructor(private readonly database: DatabaseService) {}

  @Get()
  @RequirePermission('knowledge_bases.manage')
  async list(): Promise<ProductRow[]> {
    const result = await this.database.query<ProductRow>(`${selectProduct} ORDER BY display_order, name`);
    return result.rows;
  }

  @Post()
  @RequirePermission('knowledge_bases.manage')
  async create(@Req() request: AdminRequest, @Body() body: ProductDto): Promise<ProductRow> {
    const specifications = normalizeSpecifications(body.specifications);
    try {
      const result = await this.database.query<ProductRow>(`${selectProduct.replace('FROM catalog_products', `FROM catalog_products WHERE id = $1`)} LIMIT 1`, [body.id]);
      if (result.rows.length) throw new ConflictException('Product ID already exists');
      const inserted = await this.database.query<ProductRow>(`
        INSERT INTO catalog_products
          (id, brand, name, category_id, category_name, summary, description, suggested_price, image_url, source_url, specifications, display_order, enabled)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13)
        RETURNING id, brand, name, category_id AS "categoryId", category_name AS category,
          summary, description, suggested_price AS "suggestedPrice", image_url AS "imageUrl",
          source_url AS "sourceUrl", specifications, display_order AS "displayOrder", enabled,
          updated_at AS "updatedAt"
      `, [body.id, body.brand, body.name, body.categoryId, body.category, body.summary ?? '', body.description ?? '', body.suggestedPrice ?? null, body.imageUrl ?? null, body.sourceUrl ?? null, JSON.stringify(specifications), body.displayOrder ?? 0, body.enabled ?? true]);
      const product = inserted.rows[0];
      await this.writeAudit(request.admin!.id, 'product.created', body.id, { name: body.name });
      return product;
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if ((error as { code?: string }).code === '23505') throw new ConflictException('Product ID already exists');
      throw error;
    }
  }

  @Patch(':id')
  @RequirePermission('knowledge_bases.manage')
  async update(@Req() request: AdminRequest, @Param('id') id: string, @Body() body: UpdateProductDto): Promise<ProductRow> {
    const values: unknown[] = [id];
    const assignments: string[] = [];
    const add = (column: string, value: unknown) => {
      if (value !== undefined) {
        values.push(value);
        assignments.push(`${column} = $${values.length}`);
      }
    };
    add('brand', body.brand);
    add('name', body.name);
    add('category_id', body.categoryId);
    add('category_name', body.category);
    add('summary', body.summary);
    add('description', body.description);
    add('suggested_price', body.suggestedPrice);
    add('image_url', body.imageUrl);
    add('source_url', body.sourceUrl);
    if (body.specifications !== undefined) add('specifications', JSON.stringify(normalizeSpecifications(body.specifications)));
    add('display_order', body.displayOrder);
    add('enabled', body.enabled);
    if (!assignments.length) throw new BadRequestException('No product fields to update');
    assignments.push('updated_at = now()');
    const result = await this.database.query<ProductRow>(`
      UPDATE catalog_products SET ${assignments.join(', ')}
      WHERE id = $1
      RETURNING id, brand, name, category_id AS "categoryId", category_name AS category,
        summary, description, suggested_price AS "suggestedPrice", image_url AS "imageUrl",
        source_url AS "sourceUrl", specifications, display_order AS "displayOrder", enabled,
        updated_at AS "updatedAt"
    `, values);
    const product = result.rows[0];
    if (!product) throw new NotFoundException('PRODUCT_NOT_FOUND');
    await this.writeAudit(request.admin!.id, 'product.updated', id, { fields: assignments.map((assignment) => assignment.split(' ')[0]) });
    return product;
  }

  @Delete(':id')
  @RequirePermission('knowledge_bases.manage')
  async remove(@Req() request: AdminRequest, @Param('id') id: string): Promise<{ deleted: true }> {
    const result = await this.database.query<{ id: string }>('DELETE FROM catalog_products WHERE id = $1 RETURNING id', [id]);
    if (!result.rows[0]) throw new NotFoundException('PRODUCT_NOT_FOUND');
    await this.writeAudit(request.admin!.id, 'product.deleted', id, {});
    return { deleted: true };
  }

  private async writeAudit(actorAdminId: number, action: string, targetId: string, details: Record<string, unknown>): Promise<void> {
    await this.database.query('INSERT INTO audit_logs (actor_admin_id, action, target_type, target_id, details) VALUES ($1, $2, $3, $4, $5::jsonb)', [actorAdminId, action, 'catalog_product', targetId, JSON.stringify(details)]);
  }
}
