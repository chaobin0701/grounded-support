import { onBeforeUnmount, onMounted, ref } from "vue";
import { fetchProducts, type Product } from "./catalog";

export function useProducts() {
  const products = ref<Product[]>([]);
  const loading = ref(true);
  const error = ref("");
  let controller: AbortController | undefined;
  async function reload() {
    controller?.abort();
    const active = new AbortController();
    controller = active;
    loading.value = true;
    error.value = "";
    try {
      const data = await fetchProducts(active.signal);
      if (controller === active && !active.signal.aborted)
        products.value = data;
    } catch (cause) {
      if (!active.signal.aborted)
        error.value =
          cause instanceof Error ? cause.message : "无法加载产品，请重试。";
    } finally {
      if (controller === active) loading.value = false;
    }
  }
  onMounted(reload);
  onBeforeUnmount(() => controller?.abort());
  return { products, loading, error, reload };
}
