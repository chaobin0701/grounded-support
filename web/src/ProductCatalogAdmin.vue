<script setup lang="ts">
import { Boxes, Pencil, Plus, RefreshCw, Trash2 } from '@lucide/vue';
import { onMounted, ref } from 'vue';
import AdminPageHeader from './ui/AdminPageHeader.vue';
import UiDialog from './ui/UiDialog.vue';
import { adminApi, type AdminProductItem } from './admin-api';

const props = defineProps<{ token: string }>();
const products = ref<AdminProductItem[]>([]);
const loading = ref(true);
const saving = ref(false);
const error = ref('');
const notice = ref('');
const dialogOpen = ref(false);
const editingId = ref<string | null>(null);
const specificationsText = ref('{}');

type ProductForm = {
  id: string;
  brand: string;
  name: string;
  categoryId: string;
  category: string;
  summary: string;
  description: string;
  suggestedPrice: string;
  imageUrl: string;
  sourceUrl: string;
  displayOrder: number;
  enabled: boolean;
};

const emptyForm = (): ProductForm => ({ id: '', brand: '', name: '', categoryId: 'heating', category: '取暖', summary: '', description: '', suggestedPrice: '', imageUrl: '', sourceUrl: '', displayOrder: 0, enabled: true });
const form = ref<ProductForm>(emptyForm());

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

function openCreate() {
  editingId.value = null;
  form.value = emptyForm();
  specificationsText.value = '{}';
  dialogOpen.value = true;
}

function openEdit(product: AdminProductItem) {
  editingId.value = product.id;
  form.value = { id: product.id, brand: product.brand, name: product.name, categoryId: product.categoryId ?? 'heating', category: product.category, summary: product.summary, description: product.description, suggestedPrice: product.suggestedPrice ?? '', imageUrl: product.imageUrl ?? '', sourceUrl: product.sourceUrl ?? '', displayOrder: product.displayOrder, enabled: product.enabled };
  specificationsText.value = JSON.stringify(product.specifications, null, 2);
  dialogOpen.value = true;
}

async function saveProduct() {
  if (saving.value || !form.value.id.trim() || !form.value.name.trim() || !form.value.brand.trim()) return;
  let specifications: Record<string, string>;
  try {
    const parsed: unknown = JSON.parse(specificationsText.value || '{}');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) || Object.values(parsed).some((value) => typeof value !== 'string' || !value.trim())) throw new Error();
    specifications = parsed as Record<string, string>;
  } catch {
    error.value = '规格必须是键值均为字符串的 JSON 对象。';
    return;
  }
  saving.value = true;
  error.value = '';
  try {
    if (editingId.value) {
      await adminApi.updateProduct(props.token, editingId.value, { ...form.value, specifications, suggestedPrice: form.value.suggestedPrice || null, imageUrl: form.value.imageUrl || null, sourceUrl: form.value.sourceUrl || null });
      notice.value = '产品已更新。';
    } else {
      await adminApi.createProduct(props.token, { ...form.value, specifications, suggestedPrice: form.value.suggestedPrice || null, imageUrl: form.value.imageUrl || null, sourceUrl: form.value.sourceUrl || null });
      notice.value = '产品已添加。';
    }
    dialogOpen.value = false;
    await loadProducts();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '保存产品失败，请稍后重试。';
  } finally {
    saving.value = false;
  }
}

async function deleteProduct(product: AdminProductItem) {
  if (saving.value || !window.confirm(`确定删除「${product.name}」吗？删除后官网和 Agent 将立即不再显示该产品。`)) return;
  saving.value = true;
  error.value = '';
  try {
    await adminApi.deleteProduct(props.token, product.id);
    notice.value = '产品已删除。';
    await loadProducts();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '删除产品失败，请稍后重试。';
  } finally {
    saving.value = false;
  }
}

onMounted(() => { void loadProducts(); });
</script>

<template>
  <section>
    <AdminPageHeader title="产品管理">
      <template #actions><button type="button" class="ui-button" :disabled="loading" @click="loadProducts"><RefreshCw :size="15" :class="{ 'animate-spin': loading }" /> 刷新</button><button type="button" class="ui-button ui-button-primary" @click="openCreate"><Plus :size="15" /> 添加产品</button></template>
    </AdminPageHeader>
    <div v-if="notice" class="my-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{{ notice }}</div>
    <div v-if="error" class="my-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{{ error }}</div>
    <div class="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <table class="w-full text-left text-sm">
        <thead class="bg-slate-50 text-xs text-slate-500"><tr><th class="px-5 py-3 font-medium">产品<span v-if="!loading">（{{ products.length }}）</span></th><th class="px-5 py-3 font-medium">分类</th><th class="px-5 py-3 font-medium">参考售价</th><th class="px-5 py-3 font-medium">规格</th><th class="px-5 py-3 font-medium">状态</th><th class="w-28 px-3"></th></tr></thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-for="product in products" :key="product.id" class="hover:bg-slate-50">
            <td class="px-5 py-4"><div class="flex items-center gap-3"><img v-if="product.imageUrl" :src="product.imageUrl" :alt="product.name" class="size-10 rounded-lg object-cover" /><span v-else class="grid size-10 place-items-center rounded-lg bg-brand-50 text-brand-600"><Boxes :size="18" /></span><span><strong class="block font-medium">{{ product.name }}</strong><small class="mt-1 block text-xs text-slate-400">{{ product.brand }} · {{ product.id }}</small></span></div></td>
            <td class="px-5 py-4 text-slate-600">{{ product.category }}</td><td class="px-5 py-4 text-xs text-slate-500">{{ product.suggestedPrice || '以官方渠道为准' }}</td><td class="px-5 py-4 text-slate-600">{{ Object.keys(product.specifications).length }} 项</td><td class="px-5 py-4"><span class="ui-badge" :class="product.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'">{{ product.enabled ? '已启用' : '已停用' }}</span></td><td class="px-3"><div class="flex items-center gap-1"><button type="button" class="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-brand-600" title="编辑" @click="openEdit(product)"><Pencil :size="15" /></button><button type="button" class="rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-600" title="删除" @click="deleteProduct(product)"><Trash2 :size="15" /></button></div></td>
          </tr>
          <tr v-if="!loading && !products.length"><td colspan="6" class="px-5 py-16 text-center text-sm text-slate-400">暂无产品。</td></tr><tr v-if="loading"><td colspan="6" class="px-5 py-16 text-center text-sm text-slate-400">正在加载产品目录…</td></tr>
        </tbody>
      </table>
    </div>

    <UiDialog v-model:open="dialogOpen" :title="editingId ? '编辑产品' : '添加产品'" description="保存后，官网产品列表和 Agent 产品工具会读取最新数据。" size="lg">
      <form class="grid grid-cols-2 gap-4" @submit.prevent="saveProduct">
        <label class="grid gap-2 ui-label">产品 ID<input v-model.trim="form.id" class="ui-input" required :disabled="!!editingId" placeholder="例如 xiaomi-air-purifier-pro" /></label><label class="grid gap-2 ui-label">品牌<input v-model.trim="form.brand" class="ui-input" required placeholder="例如 Xiaomi" /></label>
        <label class="col-span-2 grid gap-2 ui-label">产品名称<input v-model.trim="form.name" class="ui-input" required /></label><label class="grid gap-2 ui-label">分类 ID<input v-model.trim="form.categoryId" class="ui-input" required placeholder="例如 heating" /></label><label class="grid gap-2 ui-label">分类名称<input v-model.trim="form.category" class="ui-input" required placeholder="例如 取暖" /></label>
        <label class="col-span-2 grid gap-2 ui-label">摘要<textarea v-model.trim="form.summary" class="ui-input min-h-20 resize-y" /></label><label class="col-span-2 grid gap-2 ui-label">详细描述<textarea v-model.trim="form.description" class="ui-input min-h-24 resize-y" /></label>
        <label class="grid gap-2 ui-label">参考售价<input v-model.trim="form.suggestedPrice" class="ui-input" placeholder="例如 参考 ¥343" /></label><label class="grid gap-2 ui-label">排序<input v-model.number="form.displayOrder" type="number" min="0" class="ui-input" /></label>
        <label class="col-span-2 grid gap-2 ui-label">产品图片 URL<input v-model.trim="form.imageUrl" class="ui-input" /></label><label class="col-span-2 grid gap-2 ui-label">官方来源 URL<input v-model.trim="form.sourceUrl" class="ui-input" /></label>
        <label class="col-span-2 grid gap-2 ui-label">规格 JSON<textarea v-model="specificationsText" class="ui-input min-h-32 resize-y font-mono text-xs" placeholder='{"额定功率":"1500 W","适用面积":"15㎡以内"}' /></label>
        <label class="col-span-2 flex items-center gap-2 text-sm text-slate-700"><input v-model="form.enabled" type="checkbox" class="size-4 rounded border-slate-300 text-brand-600" /> 启用产品（官网和 Agent 可见）</label>
        <div class="col-span-2 flex justify-end gap-2"><button type="button" class="ui-button" @click="dialogOpen = false">取消</button><button type="submit" class="ui-button ui-button-primary" :disabled="saving">{{ saving ? '保存中…' : '保存产品' }}</button></div>
      </form>
    </UiDialog>
  </section>
</template>
