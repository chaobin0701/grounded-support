import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../database.service';
import { Product, ProductSummary } from './product-catalog.data';

export type { Product, ProductSummary } from './product-catalog.data';
export type ProductDetail = Product & { revision?: string };

type CatalogRow = {
  id: string;
  brand: string;
  name: string;
  category_id: string;
  category_name: string;
  summary: string;
  description: string;
  suggested_price: string | null;
  image_url: string | null;
  source_url: string | null;
  specifications: unknown;
  revision?: string;
};

function isStringRecord(value: unknown): value is Record<string, string> {
  return typeof value === 'object'
    && value !== null
    && Object.values(value).every((item) => typeof item === 'string');
}

function toProduct(row: CatalogRow): ProductDetail {
  return {
    id: row.id,
    brand: row.brand,
    name: row.name,
    categoryId: row.category_id,
    category: row.category_name,
    summary: row.summary,
    description: row.description,
    suggestedPrice: row.suggested_price,
    imageUrl: row.image_url,
    sourceUrl: row.source_url,
    specifications: isStringRecord(row.specifications) ? row.specifications : {},
    ...(row.revision ? { revision: row.revision } : {}),
  };
}

@Injectable()
export class ProductCatalogService {
  constructor(private readonly database: DatabaseService) {}

  async listCategories(): Promise<{ categories: Array<{ id: string; name: string }> }> {
    const result = await this.database.query<{ id: string; name: string }>(`
      SELECT category_id AS id, category_name AS name
      FROM catalog_products
      WHERE enabled = TRUE
      GROUP BY category_id, category_name
      ORDER BY MIN(display_order), category_id
    `);
    return { categories: result.rows };
  }

  async listProducts(categoryId?: string, search?: string): Promise<{ total: number; products: ProductSummary[] }> {
    const clauses = ['enabled = TRUE'];
    const values: unknown[] = [];
    if (categoryId) {
      values.push(categoryId);
      clauses.push(`category_id = $${values.length}`);
    }
    const needle = search?.trim();
    if (needle) {
      values.push(`%${needle}%`);
      clauses.push(`(
        name ILIKE $${values.length}
        OR summary ILIKE $${values.length}
        OR specifications::text ILIKE $${values.length}
      )`);
    }
    const result = await this.database.query<CatalogRow>(`
      SELECT id, brand, name, category_id, category_name, summary, description,
             suggested_price, image_url, source_url, specifications
      FROM catalog_products
      WHERE ${clauses.join(' AND ')}
      ORDER BY display_order, name
    `, values);
    const products = result.rows.map(toProduct).map(({ id, brand, name, categoryId: productCategoryId, category, summary, suggestedPrice, sourceUrl, specifications }): ProductSummary => ({
      id,
      brand,
      name,
      categoryId: productCategoryId,
      category,
      summary,
      suggestedPrice,
      sourceUrl,
      keySpecifications: Object.entries(specifications).slice(0, 2).map(([key, value]) => `${key}：${value}`),
    }));
    return { total: products.length, products };
  }

  async listPublicProducts(): Promise<Product[]> {
    const result = await this.database.query<CatalogRow>(`
      SELECT id, brand, name, category_id, category_name, summary, description,
             suggested_price, image_url, source_url, specifications
      FROM catalog_products
      WHERE enabled = TRUE
      ORDER BY display_order, name
    `);
    return result.rows.map(toProduct);
  }

  async getProductDetail(productId: string): Promise<ProductDetail | null> {
    const result = await this.database.query<CatalogRow>(`
      SELECT id, brand, name, category_id, category_name, summary, description,
             suggested_price, image_url, source_url, specifications, updated_at::text AS revision
      FROM catalog_products
      WHERE id = $1 AND enabled = TRUE
      LIMIT 1
    `, [productId]);
    const row = result.rows[0];
    return row ? toProduct(row) : null;
  }

  async revisions(ids: string[]): Promise<Map<string, string>> {
    const result = await this.database.query<{ id: string; revision: string }>(
      'SELECT id, updated_at::text AS revision FROM catalog_products WHERE id = ANY($1::text[]) AND enabled = TRUE', [ids],
    );
    return new Map(result.rows.map(row => [row.id, row.revision]));
  }

  async getProductDetails(ids: string[]): Promise<ProductDetail[]> {
    const result = await this.database.query<CatalogRow>(`
      SELECT id, brand, name, category_id, category_name, summary, description,
             suggested_price, image_url, source_url, specifications, updated_at::text AS revision
      FROM catalog_products WHERE id = ANY($1::text[]) AND enabled = TRUE`, [ids],
    );
    const byId = new Map(result.rows.map(row => [row.id, toProduct(row)]));
    return ids.flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
  }
}
