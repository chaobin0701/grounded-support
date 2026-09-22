<script setup lang="ts">
import { Boxes, Plus, Search } from '@lucide/vue';
import { computed, ref } from 'vue';
import UiDialog from './ui/UiDialog.vue';

const query = ref('');
const status = ref('全部状态');
type Product = { sku: string; name: string; category: string; price: string; status: string; fields: number };
const products = ref<Product[]>([
  { sku: 'NH-H2', name: '暖风机 H2', category: '环境电器', price: '¥399', status: '在售', fields: 12 },
  { sku: 'NH-A1', name: '空气净化器 A1', category: '环境电器', price: '¥899', status: '在售', fields: 16 },
  { sku: 'NH-C3', name: '循环扇 C3', category: '生活电器', price: '¥259', status: '草稿', fields: 9 },
  { sku: 'NH-D1', name: '除湿机 D1', category: '环境电器', price: '¥1,299', status: '停售', fields: 14 },
]);
const productDialog = ref(false);
const editingSku = ref<string | null>(null);
const form = ref<Product>({ sku: '', name: '', category: '环境电器', price: '', status: '草稿', fields: 0 });
const filtered = computed(() => products.value.filter(item =>
  `${item.name}${item.sku}${item.category}`.toLowerCase().includes(query.value.toLowerCase())
  && (status.value === '全部状态' || item.status === status.value),
));
function openProduct(product?: Product) {
  editingSku.value = product?.sku || null;
  form.value = product ? { ...product } : { sku: '', name: '', category: '环境电器', price: '', status: '草稿', fields: 0 };
  productDialog.value = true;
}
function saveProduct() {
  const value = { ...form.value, sku: form.value.sku.trim(), name: form.value.name.trim() };
  if (!value.sku || !value.name) return;
  const index = products.value.findIndex(item => item.sku === editingSku.value);
  if (index >= 0) products.value[index] = value; else products.value.unshift(value);
  productDialog.value = false;
}
</script>

<template>
  <section>
    <header class="flex flex-wrap items-end justify-between gap-5 border-b border-slate-200 pb-7"><div><p class="text-xs font-semibold text-brand-600">工具数据</p><h1 class="mt-2 text-3xl font-semibold tracking-[-.035em]">产品目录</h1><p class="mt-2 text-sm text-slate-500">维护提供给 Product Tool 的结构化产品数据。当前修改只保存在本次演示页面。</p></div><button class="ui-button ui-button-primary" @click="openProduct()"><Plus :size="16" /> 添加产品</button></header>
    <div class="my-6 flex flex-wrap items-center gap-3"><label class="relative min-w-64 flex-1 max-w-md"><Search :size="17" class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input v-model="query" class="ui-input pl-10" placeholder="搜索产品、SKU 或分类" /></label><label class="sr-only" for="product-status">产品状态</label><select id="product-status" v-model="status" class="ui-input w-32"><option>全部状态</option><option>在售</option><option>草稿</option><option>停售</option></select><span class="ml-auto text-xs text-slate-400">{{ filtered.length }} 个产品</span></div>
    <div class="overflow-hidden rounded-xl border border-slate-200 bg-white"><table class="w-full text-left text-sm"><thead class="bg-slate-50 text-xs text-slate-500"><tr><th class="px-5 py-3 font-medium">产品</th><th class="px-5 py-3 font-medium">分类</th><th class="px-5 py-3 font-medium">价格</th><th class="px-5 py-3 font-medium">规格字段</th><th class="px-5 py-3 font-medium">状态</th><th class="w-20"></th></tr></thead><tbody class="divide-y divide-slate-100"><tr v-for="product in filtered" :key="product.sku" class="hover:bg-slate-50"><td class="px-5 py-4"><div class="flex items-center gap-3"><span class="grid size-10 place-items-center rounded-lg bg-brand-50 text-brand-600"><Boxes :size="18" /></span><span><strong class="block font-medium">{{ product.name }}</strong><small class="mt-1 block text-xs text-slate-400">{{ product.sku }}</small></span></div></td><td class="px-5 py-4 text-slate-600">{{ product.category }}</td><td class="px-5 py-4">{{ product.price }}</td><td class="px-5 py-4 text-slate-600">{{ product.fields }}</td><td class="px-5 py-4"><span class="ui-badge" :class="product.status === '在售' ? 'bg-emerald-50 text-emerald-700' : product.status === '草稿' ? 'bg-amber-50 text-amber-700' : ''">{{ product.status }}</span></td><td class="px-3"><button class="text-xs font-medium text-brand-600 hover:text-brand-700" @click="openProduct(product)">编辑</button></td></tr><tr v-if="!filtered.length"><td colspan="6" class="px-5 py-16 text-center text-sm text-slate-400">没有匹配的产品。</td></tr></tbody></table></div>
    <UiDialog v-model:open="productDialog" :title="editingSku ? '编辑产品' : '添加产品'" description="演示数据仅保存在当前页面，后续可连接正式产品 API。"><form class="grid grid-cols-2 gap-4" @submit.prevent="saveProduct"><label class="col-span-2 grid gap-2 ui-label">产品名称<input v-model="form.name" class="ui-input" required /></label><label class="grid gap-2 ui-label">SKU<input v-model="form.sku" class="ui-input" required :disabled="!!editingSku" /></label><label class="grid gap-2 ui-label">分类<input v-model="form.category" class="ui-input" required /></label><label class="grid gap-2 ui-label">价格<input v-model="form.price" class="ui-input" placeholder="¥399" /></label><label class="grid gap-2 ui-label">状态<select v-model="form.status" class="ui-input"><option>草稿</option><option>在售</option><option>停售</option></select></label><label class="grid gap-2 ui-label">规格字段数<input v-model.number="form.fields" class="ui-input" type="number" min="0" /></label><div class="col-span-2 mt-2 flex justify-end gap-2"><button type="button" class="ui-button" @click="productDialog = false">取消</button><button class="ui-button ui-button-primary">保存产品</button></div></form></UiDialog>
  </section>
</template>
