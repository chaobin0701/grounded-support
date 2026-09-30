<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ArrowRight, Search } from '@lucide/vue';
import ProductPublicLayout from './ProductPublicLayout.vue';
import { fetchProducts, type WebsiteProduct } from './product-api';

const categories = ['全部', '取暖', '空气'];
const category = ref('全部');
const query = ref('');
const products = ref<WebsiteProduct[]>([]);
const loading = ref(true);
const filteredProducts = computed(() => products.value.filter((product) => {
  const matchesCategory = category.value === '全部' || product.category === category.value;
  const matchesQuery = `${product.name} ${product.brand}`.toLowerCase().includes(query.value.trim().toLowerCase());
  return matchesCategory && matchesQuery;
}));
onMounted(async () => {
  try {
    products.value = await fetchProducts();
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <ProductPublicLayout>
    <main class="mx-auto max-w-[1240px] px-6 py-14 lg:px-10 lg:py-20">
      <div class="flex flex-col justify-between gap-8 border-b border-[#dfe6df] pb-8 lg:flex-row lg:items-end"><div><p class="text-xs font-bold uppercase tracking-[.18em] text-[#2457e6]">产品中心</p><h1 class="mt-4 text-4xl font-semibold tracking-[-.06em] sm:text-5xl">找到适合你的产品。</h1><p class="mt-4 max-w-xl text-sm leading-7 text-[#748078]">按产品类别和关键词筛选，查看公开规格、适用场景与参考价格。</p></div><div class="flex flex-wrap items-center gap-2"><button v-for="item in categories" :key="item" type="button" class="rounded-full border px-4 py-2 text-xs font-semibold transition" :class="category === item ? 'border-[#17211e] bg-[#17211e] text-white' : 'border-[#dfe6df] bg-white text-[#68756f] hover:border-[#2457e6] hover:text-[#2457e6]'" @click="category = item">{{ item }}</button><label class="relative ml-1"><span class="sr-only">搜索产品</span><Search :size="14" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#94a099]" /><input v-model="query" class="h-9 w-44 rounded-full border border-[#dfe6df] bg-white pl-9 pr-4 text-xs outline-none transition focus:border-[#2457e6]" placeholder="搜索产品" /></label></div></div>
      <p v-if="loading" class="mt-10 border-b border-[#dfe6df] py-20 text-center text-sm text-[#87928b]">正在加载产品目录…</p><div v-else class="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3"><article v-for="product in filteredProducts" :key="product.slug" class="group overflow-hidden rounded-2xl border border-[#dfe6df] bg-white transition duration-200 hover:-translate-y-1 hover:border-[#b7c9bc] hover:shadow-[0_16px_35px_-25px_rgba(36,76,62,.5)]"><RouterLink :to="`/product/${product.slug}`" class="block"><div class="aspect-[4/3] overflow-hidden bg-[#f2f4f1]"><img :src="product.image" :alt="product.name" class="size-full object-cover transition duration-500 group-hover:scale-105" loading="lazy" /></div><div class="p-6"><div class="flex items-center justify-between gap-3"><p class="text-[11px] font-bold uppercase tracking-[.16em] text-[#8e9b93]">{{ product.brand }} · {{ product.category }}</p><span class="text-xs font-semibold text-[#2457e6]">{{ product.suggestedPrice }}</span></div><h2 class="mt-3 text-xl font-semibold tracking-[-.035em]">{{ product.name }}</h2><p class="mt-3 min-h-[48px] text-sm leading-6 text-[#748078]">{{ product.intro }}</p><div class="mt-6 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-[#edf0ed] pt-5"><div v-for="spec in product.specs.slice(0, 4)" :key="spec.label"><small class="block text-[11px] text-[#a0aaa3]">{{ spec.label }}</small><strong class="mt-1 block text-sm font-semibold text-[#34443d]">{{ spec.value }}</strong></div></div><span class="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-[#2457e6]">查看详情 <ArrowRight :size="15" class="transition group-hover:translate-x-1" /></span></div></RouterLink></article></div>
      <p v-if="!filteredProducts.length" class="border-b border-[#dfe6df] py-20 text-center text-sm text-[#87928b]">没有找到匹配的产品。</p>
      <p class="mt-8 text-xs leading-6 text-[#a0aaa3]">展示内容仅用于学习和产品信息架构演示，品牌、产品名称与规格归其权利人所有。详情页提供官方来源链接。</p>
    </main>
  </ProductPublicLayout>
</template>
