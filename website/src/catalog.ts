export type Product = {
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
};

export function safeUrl(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

export function isProduct(value: unknown): value is Product {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return (
    [
      "id",
      "brand",
      "name",
      "categoryId",
      "category",
      "summary",
      "description",
    ].every((key) => typeof p[key] === "string") &&
    Boolean(p.id) &&
    Boolean(p.name) &&
    ["suggestedPrice", "imageUrl", "sourceUrl"].every(
      (key) => p[key] === null || typeof p[key] === "string",
    ) &&
    Boolean(p.specifications) &&
    typeof p.specifications === "object" &&
    !Array.isArray(p.specifications) &&
    Object.values(p.specifications as object).every(
      (entry) => typeof entry === "string",
    )
  );
}

export function filterProducts(
  products: Product[],
  category: string,
  query: string,
): Product[] {
  const term = query.trim().toLocaleLowerCase();
  return products.filter(
    (p) =>
      (!category || p.categoryId === category) &&
      `${p.name} ${p.brand} ${p.category} ${p.summary}`
        .toLocaleLowerCase()
        .includes(term),
  );
}

export function categoryOptions(products: Product[]) {
  return [
    ...new Map(
      products.map((p) => [
        p.categoryId,
        { id: p.categoryId, name: p.category },
      ]),
    ).values(),
  ];
}

export class CatalogError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request(path: string, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(10_000);
  let response: Response;
  try {
    response = await fetch(`/api/products${path}`, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new CatalogError(
      0,
      timeout.aborted
        ? "读取产品资料超时，请稍后重试。"
        : "无法连接产品服务，请检查网络后重试。",
    );
  }
  if (!response.ok)
    throw new CatalogError(
      response.status,
      response.status === 404
        ? "该产品不存在或已下架。"
        : "产品资料暂时无法加载，请稍后重试。",
    );
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new CatalogError(
      response.status,
      "产品资料格式异常，请重试或联系管理员。",
    );
  }
}
export async function fetchProducts(signal?: AbortSignal): Promise<Product[]> {
  const data = await request("", signal);
  if (!Array.isArray(data) || !data.every(isProduct))
    throw new Error("产品资料格式异常，请重试或联系管理员。");
  return data;
}
export async function fetchProduct(
  id: string,
  signal?: AbortSignal,
): Promise<Product> {
  const data = await request(`/${encodeURIComponent(id)}`, signal);
  if (!isProduct(data))
    throw new Error("产品资料格式异常，请重试或联系管理员。");
  return data;
}
