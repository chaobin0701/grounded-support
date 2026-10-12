<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { ArrowLeft, ArrowUpRight, BookOpen } from "@lucide/vue";
import { fetchProduct, safeManualUrl, type Product } from "../catalog";
import { chat } from "../chat/service";
import ProductImage from "../components/ProductImage.vue";
import RichDescription from "../components/RichDescription.vue";
import CatalogState from "../components/CatalogState.vue";
const route = useRoute();
const product = ref<Product | null>(null);
const loading = ref(true);
const error = ref("");
const manual = computed(
  () =>
    safeManualUrl(product.value?.specifications?.["电子说明书"]) ||
    (product.value?.id ? `/manuals/${encodeURIComponent(product.value.id)}.pdf` : "")
);
const productBrand = computed(() =>
  product.value?.brand === "Midea"
    ? "美的"
    : product.value?.brand === "Xiaomi"
      ? "小米"
      : product.value?.brand,
);
let controller: AbortController | undefined;
async function load() {
  controller?.abort();
  const current = new AbortController();
  controller = current;
  loading.value = true;
  error.value = "";
  product.value = null;
  try {
    const data = await fetchProduct(String(route.params.id), current.signal);
    if (controller === current && !current.signal.aborted) {
      product.value = data;
      document.title = `${data.name} · 禾序智能`;
    }
  } catch (cause) {
    if (!current.signal.aborted)
      error.value = cause instanceof Error ? cause.message : "产品暂不可用。";
  } finally {
    if (controller === current) loading.value = false;
  }
}
watch(() => route.params.id, load, { immediate: true });
onBeforeUnmount(() => controller?.abort());
</script>

<template>
  <section class="container detail-page">
    <RouterLink to="/products" class="text-link back-link"
      ><ArrowLeft :size="17" />返回产品中心</RouterLink
    ><CatalogState :loading="loading" :error="error" @retry="load" /><template
      v-if="product && !loading && !error"
      ><div v-reveal class="detail-layout">
        <ProductImage :src="product.imageUrl" :alt="product.name" eager />
        <div class="detail-copy">
          <p class="eyebrow">{{ product.category }} · {{ productBrand }}</p>
          <h1>{{ product.name }}</h1>
          <p class="detail-summary">{{ product.summary }}</p>
          <p class="detail-price">
            {{ product.suggestedPrice || "价格以官方渠道为准" }}
          </p>
          <div class="detail-actions">
            <a
              v-if="manual"
              :href="manual"
              target="_blank"
              download
              class="button button-primary"
              ><BookOpen :size="18" /> 电子说明书</a
            ><button
              type="button"
              @click="chat.openWidget({ id: product.id, name: product.name })"
              class="button button-outline"
            >
              咨询产品
            </button>
          </div>
        </div>
      </div>
      <div class="detail-info">
        <section v-reveal>
          <p class="eyebrow">了解产品</p>
          <h2>产品介绍与使用指南</h2>
          <RichDescription
            v-if="product.description"
            :text="product.description"
          />
          <p v-else>暂无更详细的描述。</p>
          <RouterLink to="/support#documents" class="text-link"
            ><BookOpen :size="17" />查阅使用与服务资料 <ArrowUpRight :size="16"
          /></RouterLink>
        </section>
        <section v-reveal="{ delay: 0.06 }">
          <p class="eyebrow">参数与规格</p>
          <h2>把信息看清楚</h2>
          <dl class="spec-list">
            <div v-for="(value, label) in product.specifications" :key="label">
              <dt>{{ label }}</dt>
              <dd v-if="String(label) === '电子说明书' && safeManualUrl(value)">
                <a
                  :href="safeManualUrl(value)"
                  target="_blank"
                  download
                  class="text-link"
                  >下载电子说明书 (PDF) <ArrowUpRight :size="14"
                /></a>
              </dd>
              <dd v-else>{{ value }}</dd>
            </div>
          </dl>
          <p v-if="!Object.keys(product.specifications).length">
            暂无完整规格。
          </p>
        </section>
      </div></template
    >
  </section>
</template>
