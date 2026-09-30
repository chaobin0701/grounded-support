import { Injectable } from '@nestjs/common';
import { categories, products, Product } from './product-catalog.data';

export type ProductSummary = Pick<Product, 'id' | 'name' | 'categoryId' | 'summary' | 'suggestedPrice' | 'sourceUrl'> & { keySpecifications: string[] };
export type ProductDetail = Product;

@Injectable()
export class ProductCatalogService {
  listCategories() {
    return { categories };
  }

  listProducts(categoryId?: string, search?: string) {
    const needle = search?.trim().toLowerCase();
    const matched = products.filter((product) =>
      (!categoryId || product.categoryId === categoryId)
      && (!needle || `${product.name} ${product.summary} ${Object.values(product.specifications).join(' ')}`.toLowerCase().includes(needle)),
    );
    return {
      total: matched.length,
      products: matched.map(({ id, name, categoryId: category, summary, suggestedPrice, sourceUrl, specifications }): ProductSummary => ({
        id,
        name,
        categoryId: category,
        summary,
        suggestedPrice,
        sourceUrl,
        keySpecifications: Object.entries(specifications).slice(0, 2).map(([key, value]) => `${key}：${value}`),
      })),
    };
  }

  getProductDetail(productId: string): ProductDetail | null {
    return products.find((product) => product.id === productId) ?? null;
  }
}
