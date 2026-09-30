<script setup lang="ts">
import { Boxes, RefreshCw } from '@lucide/vue';
import { onMounted, ref } from 'vue';
import AdminPageHeader from './ui/AdminPageHeader.vue';
import { adminApi, type AdminProductItem } from './admin-api';

const props = defineProps<{ token: string }>();
const products = ref<AdminProductItem[]>([]);
const loading = ref(true);
const error = ref('');

async function loadProducts() {
  loading.value = true;
  error.value = '';
  try {
    products.value = await adminApi.products(props.token);
  } catch {
    error.value = '产品目录加载失败，请稍后重试。';
  } finally {
    loading.value = false;
  }
}

onMounted(() => { void loadProducts(); });
</script>

<template>
  <section>
    <AdminPageHeader eyebrow="工具数据" title="产品管理" description="数据库中的统一产品目录，同时供官网产品列表和 Agent 产品工具使用。">
      <template #actions><button type="button" class="ui-button" :disabled="loading" @click="loadProducts"><RefreshCw :size="15" :class="{ 'animate-spin': loading }" /> 刷新</button></template>
    </AdminPageHeader>
    <div class="my-6 flex items-center justify-between text-sm text-slate-500"><span>当前目录 {{ products.length }} 个商品</span><span class="text-xs text-slate-400">官网与 Agent 共用此数据源</span></div>
    <div v-if="error" class="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{{ error }}</div>
    <div class="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <table class="w-full text-left text-sm">
        <thead class="bg-slate-50 text-xs text-slate-500"><tr><th class="px-5 py-3 font-medium">产品</th><th class="px-5 py-3 font-medium">分类</th><th class="px-5 py-3 font-medium">参考售价</th><th class="px-5 py-3 font-medium">规格</th><th class="px-5 py-3 font-medium">状态</th></tr></thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-for="product in products" :key="product.id" class="hover:bg-slate-50">
            <td class="px-5 py-4"><div class="flex items-center gap-3"><img v-if="product.imageUrl" :src="product.imageUrl" :alt="product.name" class="size-10 rounded-lg object-cover" /><span v-else class="grid size-10 place-items-center rounded-lg bg-brand-50 text-brand-600"><Boxes :size="18" /></span><span><strong class="block font-medium">{{ product.name }}</strong><small class="mt-1 block text-xs text-slate-400">{{ product.brand }} · {{ product.id }}</small></span></div></td>
            <td class="px-5 py-4 text-slate-600">{{ product.category }}</td>
            <td class="px-5 py-4 text-xs text-slate-500">{{ product.suggestedPrice || '以官方渠道为准' }}</td>
            <td class="px-5 py-4 text-slate-600">{{ Object.keys(product.specifications).length }} 项</td>
            <td class="px-5 py-4"><span class="ui-badge" :class="product.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'">{{ product.enabled ? '已启用' : '已停用' }}</span></td>
          </tr>
          <tr v-if="!loading && !products.length"><td colspan="5" class="px-5 py-16 text-center text-sm text-slate-400">暂无产品。</td></tr>
          <tr v-if="loading"><td colspan="5" class="px-5 py-16 text-center text-sm text-slate-400">正在加载产品目录…</td></tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
