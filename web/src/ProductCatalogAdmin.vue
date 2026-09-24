<script setup lang="ts">
import { Boxes, Plus, Search } from '@lucide/vue';
import { computed, ref } from 'vue';
import AdminPageHeader from './ui/AdminPageHeader.vue';
import UiDialog from './ui/UiDialog.vue';

const query = ref('');
const status = ref('全部状态');
type Product = { sku: string; name: string; category: string; price: string; status: string; specifications: { name: string; value: string }[] };
const products = ref<Product[]>([
  { sku: 'NH-H2', name: '暖风机 H2', category: '环境电器', price: '¥399', status: '在售', specifications: [{ name: '额定功率', value: '2200 W' }, { name: '适用面积', value: '10–20 m²' }] },
  { sku: 'NH-A1', name: '空气净化器 A1', category: '环境电器', price: '¥899', status: '在售', specifications: [{ name: 'CADR', value: '420 m³/h' }, { name: '适用面积', value: '30–50 m²' }] },
  { sku: 'NH-C3', name: '循环扇 C3', category: '生活电器', price: '¥259', status: '草稿', specifications: [{ name: '风速档位', value: '8 档' }] },
  { sku: 'NH-D1', name: '除湿机 D1', category: '环境电器', price: '¥1,299', status: '停售', specifications: [{ name: '日除湿量', value: '20 L' }, { name: '水箱容量', value: '5 L' }] },
]);
const productDialog = ref(false);
const editingSku = ref<string | null>(null);
const form = ref<Product>({ sku: '', name: '', category: '环境电器', price: '', status: '草稿', specifications: [] });
const filtered = computed(() => products.value.filter(item =>
  `${item.name}${item.sku}${item.category}`.toLowerCase().includes(query.value.toLowerCase())
  && (status.value === '全部状态' || item.status === status.value),
));
function openProduct(product?: Product) {
  editingSku.value = product?.sku || null;
  form.value = product ? { ...product, specifications: product.specifications.map(item => ({ ...item })) } : { sku: '', name: '', category: '环境电器', price: '', status: '草稿', specifications: [] };
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
    <AdminPageHeader eyebrow="工具数据" title="产品目录" description="维护提供给 Product Tool 的结构化产品数据。当前修改只保存在本次演示页面。">
      <template #actions><button class="ui-button ui-button-primary" @click="openProduct()"><Plus :size="16" /> 添加产品</button></template>
    </AdminPageHeader>
    <div class="my-6 flex flex-wrap items-center gap-3"><label class="relative min-w-64 flex-1 max-w-md"><Search :size="17" class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input v-model="query" class="ui-input pl-10" placeholder="搜索产品、SKU 或分类" /></label><label class="sr-only" for="product-status">产品状态</label><select id="product-status" v-model="status" class="ui-input w-32"><option>全部状态</option><option>在售</option><option>草稿</option><option>停售</option></select><span class="ml-auto text-xs text-slate-400">{{ filtered.length }} 个产品</span></div>
    <div class="overflow-hidden rounded-xl border border-slate-200 bg-white"><table class="w-full text-left text-sm"><thead class="bg-slate-50 text-xs text-slate-500"><tr><th class="px-5 py-3 font-medium">产品</th><th class="px-5 py-3 font-medium">分类</th><th class="px-5 py-3 font-medium">价格</th><th class="px-5 py-3 font-medium">规格字段</th><th class="px-5 py-3 font-medium">状态</th><th class="w-20"></th></tr></thead><tbody class="divide-y divide-slate-100"><tr v-for="product in filtered" :key="product.sku" class="hover:bg-slate-50"><td class="px-5 py-4"><div class="flex items-center gap-3"><span class="grid size-10 place-items-center rounded-lg bg-brand-50 text-brand-600"><Boxes :size="18" /></span><span><strong class="block font-medium">{{ product.name }}</strong><small class="mt-1 block text-xs text-slate-400">{{ product.sku }}</small></span></div></td><td class="px-5 py-4 text-slate-600">{{ product.category }}</td><td class="px-5 py-4">{{ product.price }}</td><td class="px-5 py-4 text-slate-600">{{ product.specifications.length }}</td><td class="px-5 py-4"><span class="ui-badge" :class="product.status === '在售' ? 'bg-emerald-50 text-emerald-700' : product.status === '草稿' ? 'bg-amber-50 text-amber-700' : ''">{{ product.status }}</span></td><td class="px-3"><button class="text-xs font-medium text-brand-600 hover:text-brand-700" @click="openProduct(product)">编辑</button></td></tr><tr v-if="!filtered.length"><td colspan="6" class="px-5 py-16 text-center text-sm text-slate-400">没有匹配的产品。</td></tr></tbody></table></div>
    <UiDialog v-model:open="productDialog" :title="editingSku ? '编辑产品' : '添加产品'" description="演示数据仅保存在当前页面，后续可连接正式产品 API。" size="lg"><form class="grid grid-cols-2 gap-4" @submit.prevent="saveProduct"><label class="col-span-2 grid gap-2 ui-label">产品名称<input v-model="form.name" class="ui-input" required /></label><label class="grid gap-2 ui-label">SKU<input v-model="form.sku" class="ui-input" required :disabled="!!editingSku" /></label><label class="grid gap-2 ui-label">分类<input v-model="form.category" class="ui-input" required /></label><label class="grid gap-2 ui-label">价格<input v-model="form.price" class="ui-input" placeholder="¥399" /></label><label class="grid gap-2 ui-label">状态<select v-model="form.status" class="ui-input"><option>草稿</option><option>在售</option><option>停售</option></select></label><div class="col-span-2 border-t border-slate-100 pt-4"><div class="mb-3 flex items-center justify-between"><div><strong class="text-sm font-semibold text-slate-800">产品规格</strong><p class="mt-1 text-xs text-slate-500">用键值对维护客户可以询问的产品属性。</p></div><button type="button" class="ui-button" @click="form.specifications.push({ name: '', value: '' })">添加规格</button></div><div v-for="(specification, index) in form.specifications" :key="index" class="mb-2 grid grid-cols-[1fr_1fr_auto] gap-2"><input v-model.trim="specification.name" class="ui-input" required placeholder="规格名称，如额定功率" /><input v-model.trim="specification.value" class="ui-input" required placeholder="规格值，如 2200 W" /><button type="button" class="px-3 text-sm text-slate-500 hover:text-red-600" aria-label="删除规格" @click="form.specifications.splice(index, 1)">移除</button></div><p v-if="!form.specifications.length" class="text-xs text-slate-400">尚未添加规格。</p></div><div class="col-span-2 mt-2 flex justify-end gap-2"><button type="button" class="ui-button" @click="productDialog = false">取消</button><button class="ui-button ui-button-primary">保存产品</button></div></form></UiDialog>
  </section>
</template>
