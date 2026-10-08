<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { RefreshCw, Search, X } from "@lucide/vue";
import { categoryOptions, filterProducts } from "../catalog";
import { useProducts } from "../useProducts";
import ProductCard from "../components/ProductCard.vue";
import CatalogState from "../components/CatalogState.vue";
const route = useRoute();
const router = useRouter();
const { products, loading, error, reload } = useProducts();
const category = computed(() =>
  typeof route.query.category === "string" ? route.query.category : "",
);
const query = computed({
  get: () => (typeof route.query.q === "string" ? route.query.q : ""),
  set: (q) => {
    void router.replace({ query: { ...route.query, q: q || undefined } });
  },
});
const categories = computed(() => categoryOptions(products.value));
const filtered = computed(() =>
  filterProducts(products.value, category.value, query.value),
);
function selectCategory(id: string) {
  void router.replace({ query: { ...route.query, category: id || undefined } });
}
function reset() {
  void router.replace({ query: {} });
}
</script>

<template>
  <section class="container catalog-page">
    <div v-reveal class="page-heading">
      <p class="eyebrow">产品中心</p>
      <h1>适合家的，才是好的。</h1>
      <p>看看取暖与空气产品，找到你需要的舒适。</p>
    </div>
    <div class="catalog-toolbar">
      <div class="category-tabs" role="group" aria-label="产品分类">
        <button
          type="button"
          :aria-pressed="!category"
          :class="{ selected: !category }"
          @click="selectCategory('')"
        >
          全部产品</button
        ><button
          v-for="item in categories"
          :key="item.id"
          type="button"
          :aria-pressed="category === item.id"
          :class="{ selected: category === item.id }"
          @click="selectCategory(item.id)"
        >
          {{ item.name }}
        </button>
      </div>
      <div class="catalog-actions">
        <label class="search-field"
          ><Search :size="18" /><span class="sr-only">搜索产品</span
          ><input
            v-model="query"
            type="search"
            placeholder="搜索产品名称或型号" /></label
        ><button
          class="icon-button"
          type="button"
          aria-label="刷新产品目录"
          :disabled="loading"
          @click="reload"
        >
          <RefreshCw :size="19" :class="{ spinner: loading }" />
        </button>
      </div>
    </div>
    <div v-if="!loading && !error" class="catalog-summary" aria-live="polite">
      <span>{{ filtered.length }} 款产品</span
      ><button
        v-if="category || query"
        class="text-link"
        type="button"
        @click="reset"
      >
        清除筛选 <X :size="14" />
      </button>
    </div>
    <CatalogState
      :loading="loading"
      :error="error"
      :empty="!filtered.length"
      @retry="reload"
    />
    <div v-if="!loading && !error" class="product-grid">
      <div
        v-for="(product, index) in filtered"
        :key="product.id"
        v-reveal="{ delay: (index % 4) * 0.06 }"
      >
        <ProductCard :product="product" />
      </div>
    </div>
  </section>
</template>
