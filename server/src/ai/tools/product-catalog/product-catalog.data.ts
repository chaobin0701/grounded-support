export type Product = {
  id: string;
  brand: string;
  name: string;
  categoryId: string;
  category: string;
  summary: string;
  description: string;
  specifications: Record<string, string>;
  suggestedPrice: string | null;
  imageUrl: string | null;
  sourceUrl: string | null;
};

/**
 * Product records are persisted in catalog_products. Keeping only the wire
 * types here prevents the Agent catalog and the public website from drifting.
 */
export type ProductSummary = Pick<
  Product,
  'id' | 'brand' | 'name' | 'categoryId' | 'category' | 'summary' | 'suggestedPrice' | 'sourceUrl'
> & { keySpecifications: string[] };
