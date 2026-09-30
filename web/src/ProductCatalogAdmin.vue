<script setup lang="ts">
import { Boxes, Plus, Search } from '@lucide/vue';
import { computed, ref } from 'vue';
import AdminPageHeader from './ui/AdminPageHeader.vue';
import UiDialog from './ui/UiDialog.vue';

const query = ref('');
const status = ref('全部状态');
type Product = { sku: string; name: string; brand: string; category: string; price: string; status: string; source: string; specifications: { name: string; value: string }[] };
const products = ref<Product[]>([
  { sku: 'HFT20ZBJ', brand: 'Midea', name: '美的塔式暖风机', category: '取暖', price: '参考官方渠道', status: '参考', source: '美的官方商城', specifications: [{ name: '额定功率', value: '2000 W' }, { name: '适用面积', value: '10㎡以下' }, { name: '档位', value: '3 档' }] },
  { sku: 'MJDNQ', brand: 'Xiaomi', name: '米家电暖器', category: '取暖', price: '参考官方渠道', status: '参考', source: '小米官方规格页', specifications: [{ name: '额定功率', value: '1500 W' }, { name: '适用面积', value: '15㎡以内' }, { name: '防护等级', value: 'IPX4' }] },
  { sku: 'AC-M16-SC', brand: 'Xiaomi', name: '米家空气净化器 Pro', category: '空气', price: '参考官方渠道', status: '参考', source: '小米官方产品页', specifications: [{ name: '颗粒物 CADR', value: '500 m³/h' }, { name: '适用面积', value: '35–60㎡' }, { name: '显示', value: 'OLED' }] },
  { sku: 'MJXFJ-300-G1', brand: 'Xiaomi', name: '米家新风机', category: '空气', price: '参考官方渠道', status: '参考', source: '小米官方规格页', specifications: [{ name: '额定风量', value: '300 m³/h' }, { name: '适用面积', value: '≤105㎡' }, { name: '辅热功率', value: '800 W' }] },
]);
const productDialog = ref(false);
const editingSku = ref<string | null>(null);
const form = ref<Product>({ sku: '', name: '', brand: '', category: '取暖', price: '', status: '参考', source: '', specifications: [] });
const filtered = computed(() => products.value.filter(item =>
  `${item.name}${item.sku}${item.category}`.toLowerCase().includes(query.value.toLowerCase())
  && (status.value === '全部状态' || item.status === status.value),
));
function openProduct(product?: Product) {
  editingSku.value = product?.sku || null;
  form.value = product ? { ...product, specifications: product.specifications.map(item => ({ ...item })) } : { sku: '', name: '', brand: '', category: '取暖', price: '', status: '参考', source: '', specifications: [] };
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
    <AdminPageHeader eyebrow="工具数据" title="产品目录" description="维护展示给 AI 助手的产品资料。当前内置了来自美的和小米官方公开规格的学习样本。">
      <template #actions><button class="ui-button ui-button-primary" @click="openProduct()"><Plus :size="16" /> 添加产品</button></template>
    </AdminPageHeader>
    <div class="my-6 flex flex-wrap items-center gap-3"><label class="relative min-w-64 flex-1 max-w-md"><Search :size="17" class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input v-model="query" class="ui-input pl-10" placeholder="搜索产品、品牌、SKU 或分类" /></label><label class="sr-only" for="product-status">产品状态</label><select id="product-status" v-model="status" class="ui-input w-32"><option>全部状态</option><option>参考</option><option>草稿</option></select><span class="ml-auto text-xs text-slate-400">{{ filtered.length }} 个产品</span></div>
    <div class="overflow-hidden rounded-xl border border-slate-200 bg-white"><table class="w-full text-left text-sm"><thead class="bg-slate-50 text-xs text-slate-500"><tr><th class="px-5 py-3 font-medium">产品</th><th class="px-5 py-3 font-medium">分类</th><th class="px-5 py-3 font-medium">来源</th><th class="px-5 py-3 font-medium">规格字段</th><th class="px-5 py-3 font-medium">状态</th><th class="w-20"></th></tr></thead><tbody class="divide-y divide-slate-100"><tr v-for="product in filtered" :key="product.sku" class="hover:bg-slate-50"><td class="px-5 py-4"><div class="flex items-center gap-3"><span class="grid size-10 place-items-center rounded-lg bg-brand-50 text-brand-600"><Boxes :size="18" /></span><span><strong class="block font-medium">{{ product.name }}</strong><small class="mt-1 block text-xs text-slate-400">{{ product.brand }} · {{ product.sku }}</small></span></div></td><td class="px-5 py-4 text-slate-600">{{ product.category }}</td><td class="px-5 py-4 text-xs text-slate-500">{{ product.source }}</td><td class="px-5 py-4 text-slate-600">{{ product.specifications.length }}</td><td class="px-5 py-4"><span class="ui-badge bg-slate-100 text-slate-600">{{ product.status }}</span></td><td class="px-3"><button class="text-xs font-medium text-brand-600 hover:text-brand-700" @click="openProduct(product)">编辑</button></td></tr><tr v-if="!filtered.length"><td colspan="6" class="px-5 py-16 text-center text-sm text-slate-400">没有匹配的产品。</td></tr></tbody></table></div>
    <UiDialog v-model:open="productDialog" :title="editingSku ? '编辑产品' : '添加产品'" description="产品规格来自公开资料或后台维护，仅用于学习演示；实际价格和库存不在此维护。" size="lg"><form class="grid grid-cols-2 gap-4" @submit.prevent="saveProduct"><label class="col-span-2 grid gap-2 ui-label">产品名称<input v-model="form.name" class="ui-input" required /></label><label class="grid gap-2 ui-label">品牌<input v-model="form.brand" class="ui-input" required /></label><label class="grid gap-2 ui-label">SKU / 型号<input v-model="form.sku" class="ui-input" required :disabled="!!editingSku" /></label><label class="grid gap-2 ui-label">分类<input v-model="form.category" class="ui-input" required /></label><label class="grid gap-2 ui-label">来源<input v-model="form.source" class="ui-input" placeholder="官方规格页" /></label><div class="col-span-2 border-t border-slate-100 pt-4"><div class="mb-3 flex items-center justify-between"><div><strong class="text-sm font-semibold text-slate-800">产品规格</strong><p class="mt-1 text-xs text-slate-500">用键值对维护客户可以询问的产品属性。</p></div><button type="button" class="ui-button" @click="form.specifications.push({ name: '', value: '' })">添加规格</button></div><div v-for="(specification, index) in form.specifications" :key="index" class="mb-2 grid grid-cols-[1fr_1fr_auto] gap-2"><input v-model.trim="specification.name" class="ui-input" required placeholder="规格名称，如额定功率" /><input v-model.trim="specification.value" class="ui-input" required placeholder="规格值，如 1500 W" /><button type="button" class="px-3 text-sm text-slate-500 hover:text-red-600" aria-label="删除规格" @click="form.specifications.splice(index, 1)">移除</button></div><p v-if="!form.specifications.length" class="text-xs text-slate-400">尚未添加规格。</p></div><div class="col-span-2 mt-2 flex justify-end gap-2"><button type="button" class="ui-button" @click="productDialog = false">取消</button><button class="ui-button ui-button-primary">保存产品</button></div></form></UiDialog>
  </section>
</template>
