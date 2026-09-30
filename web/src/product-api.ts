export type WebsiteProduct = {
  slug: string;
  brand: string;
  name: string;
  category: string;
  intro: string;
  description: string[];
  accent: string;
  image: string;
  suggestedPrice: string;
  specs: { label: string; value: string }[];
  source: string;
  sourceLabel: string;
  note: string;
};

type ApiProduct = {
  id: string;
  brand: string;
  name: string;
  category: string;
  summary: string;
  description: string;
  specifications: Record<string, string>;
  suggestedPrice: string | null;
  imageUrl: string | null;
  sourceUrl: string | null;
};

function toWebsiteProduct(product: ApiProduct): WebsiteProduct {
  return {
    slug: product.id,
    brand: product.brand,
    name: product.name,
    category: product.category,
    intro: product.summary,
    description: product.description ? [product.description] : [],
    accent: product.brand === 'Midea' ? '#e46c45' : '#2457e6',
    image: product.imageUrl ?? '',
    suggestedPrice: product.suggestedPrice ?? '以官方渠道为准',
    specs: Object.entries(product.specifications).map(([label, value]) => ({ label, value })),
    source: product.sourceUrl ?? '',
    sourceLabel: product.brand === 'Midea' ? '美的官方商城规格' : '小米官方规格页',
    note: '展示内容来自统一产品目录，价格、库存和促销请以官方渠道为准。',
  };
}

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`/api${path}`);
  if (!response.ok) throw new Error(`产品目录请求失败：${response.status}`);
  return response.json() as Promise<T>;
}

export async function fetchProducts(): Promise<WebsiteProduct[]> {
  const products = await request<ApiProduct[]>('/products');
  return products.map(toWebsiteProduct);
}

export async function fetchProduct(id: string): Promise<WebsiteProduct> {
  return toWebsiteProduct(await request<ApiProduct>(`/products/${encodeURIComponent(id)}`));
}
