<script setup lang="ts">
import { BookOpen, Boxes, ExternalLink, Pencil, Plus, RefreshCw, Trash2 } from '@lucide/vue';
import { onMounted, ref, watch } from 'vue';
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

// Preset categories for quick picking
const PRESET_CATEGORIES = [
  { id: 'cooling', name: '风扇' },
  { id: 'kitchen', name: '厨房电器' },
  { id: 'cleaning', name: '清洁电器' },
  { id: 'lighting', name: '照明' },
  { id: 'air', name: '空气' },
  { id: 'heating', name: '取暖' },
  { id: 'security', name: '家庭安防' },
  { id: 'environment', name: '环境监测' },
];

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
  manualUrl: string;
  officialModel: string;
  packageContents: string;
  displayOrder: number;
  enabled: boolean;
};

const emptyForm = (): ProductForm => ({
  id: '',
  brand: 'Xiaomi',
  name: '',
  categoryId: 'cooling',
  category: '风扇',
  summary: '',
  description: '',
  suggestedPrice: '',
  imageUrl: '',
  manualUrl: '',
  officialModel: '',
  packageContents: '',
  displayOrder: 0,
  enabled: true,
});

const form = ref<ProductForm>(emptyForm());
const specificationsText = ref('{}');
const customSpecsError = ref('');

function onPresetCategoryChange(event: Event) {
  const target = event.target as HTMLSelectElement;
  const match = PRESET_CATEGORIES.find((c) => c.id === target.value);
  if (match) {
    form.value.categoryId = match.id;
    form.value.category = match.name;
  }
}

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
  specificationsText.value = '{\n  "额定功率": "15 W",\n  "额定电压": "220 V / 50 Hz"\n}';
  customSpecsError.value = '';
  dialogOpen.value = true;
}

function openEdit(product: AdminProductItem) {
  editingId.value = product.id;
  const specs = { ...(product.specifications || {}) };
  const manualUrl = specs['电子说明书'] || '';
  const officialModel = specs['官方型号'] || '';
  const packageContents = specs['包装清单'] || '';

  // Keep remaining custom keys in the JSON editor
  const customSpecs = { ...specs };
  delete customSpecs['电子说明书'];
  delete customSpecs['官方型号'];
  delete customSpecs['包装清单'];

  form.value = {
    id: product.id,
    brand: product.brand,
    name: product.name,
    categoryId: product.categoryId ?? 'cooling',
    category: product.category,
    summary: product.summary,
    description: product.description,
    suggestedPrice: product.suggestedPrice ?? '',
    imageUrl: product.imageUrl ?? '',
    manualUrl,
    officialModel,
    packageContents,
    displayOrder: product.displayOrder,
    enabled: product.enabled,
  };

  specificationsText.value = Object.keys(customSpecs).length ? JSON.stringify(customSpecs, null, 2) : '{}';
  customSpecsError.value = '';
  dialogOpen.value = true;
}

// Watch ID change to auto-suggest manual path when creating
watch(() => form.value.id, (newId) => {
  if (!editingId.value && newId.trim() && !form.value.manualUrl) {
    form.value.manualUrl = `/manuals/${newId.trim()}.pdf`;
  }
});

async function saveProduct() {
  if (saving.value || !form.value.id.trim() || !form.value.name.trim() || !form.value.brand.trim()) return;

  let customSpecs: Record<string, string> = {};
  try {
    const parsed: unknown = JSON.parse(specificationsText.value || '{}');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) || Object.values(parsed).some((v) => typeof v !== 'string' || !v.trim())) {
      throw new Error();
    }
    customSpecs = parsed as Record<string, string>;
    customSpecsError.value = '';
  } catch {
    customSpecsError.value = '自定义规格必须是键值均为非空字符串的 JSON 对象。';
    return;
  }

  // Merge structured fields into specifications
  const finalSpecifications: Record<string, string> = { ...customSpecs };
  if (form.value.officialModel.trim()) {
    finalSpecifications['官方型号'] = form.value.officialModel.trim();
  }
  if (form.value.manualUrl.trim()) {
    finalSpecifications['电子说明书'] = form.value.manualUrl.trim();
  }
  if (form.value.packageContents.trim()) {
    finalSpecifications['包装清单'] = form.value.packageContents.trim();
  }

  saving.value = true;
  error.value = '';
  try {
    const payload = {
      id: form.value.id.trim(),
      brand: form.value.brand.trim(),
      name: form.value.name.trim(),
      categoryId: form.value.categoryId.trim(),
      category: form.value.category.trim(),
      summary: form.value.summary.trim(),
      description: form.value.description.trim(),
      suggestedPrice: form.value.suggestedPrice.trim() || null,
      imageUrl: form.value.imageUrl.trim() || null,
      sourceUrl: null, // Clear external source URL to keep AI grounded locally
      specifications: finalSpecifications,
      displayOrder: form.value.displayOrder,
      enabled: form.value.enabled,
    };

    if (editingId.value) {
      await adminApi.updateProduct(props.token, editingId.value, payload);
      notice.value = '产品已成功更新。';
    } else {
      await adminApi.createProduct(props.token, payload);
      notice.value = '产品已成功添加。';
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

function getManualPath(product: AdminProductItem): string | null {
  return product.specifications?.['电子说明书'] || null;
}

onMounted(() => { void loadProducts(); });
</script>

<template>
  <section>
    <AdminPageHeader title="产品管理">
      <template #actions>
        <button type="button" class="ui-button" :disabled="loading" @click="loadProducts">
          <RefreshCw :size="15" :class="{ 'animate-spin': loading }" /> 刷新
        </button>
        <button type="button" class="ui-button ui-button-primary" @click="openCreate">
          <Plus :size="15" /> 添加产品
        </button>
      </template>
    </AdminPageHeader>

    <div v-if="notice" class="my-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
      {{ notice }}
    </div>
    <div v-if="error" class="my-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {{ error }}
    </div>

    <div class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <table class="w-full text-left text-sm">
        <thead class="bg-slate-50 text-xs text-slate-500">
          <tr>
            <th class="px-5 py-3 font-medium">产品信息<span v-if="!loading">（{{ products.length }}）</span></th>
            <th class="px-4 py-3 font-medium">分类</th>
            <th class="px-4 py-3 font-medium">参考售价</th>
            <th class="px-4 py-3 font-medium">电子说明书</th>
            <th class="px-4 py-3 font-medium">规格项</th>
            <th class="px-4 py-3 font-medium">状态</th>
            <th class="w-28 px-3"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-for="product in products" :key="product.id" class="hover:bg-slate-50 transition-colors">
            <td class="px-5 py-4">
              <div class="flex items-center gap-3">
                <img v-if="product.imageUrl" :src="product.imageUrl" :alt="product.name" class="size-10 rounded-lg object-cover border border-slate-100" />
                <span v-else class="grid size-10 place-items-center rounded-lg bg-teal-50 text-teal-600">
                  <Boxes :size="18" />
                </span>
                <div>
                  <strong class="block font-medium text-slate-900">{{ product.name }}</strong>
                  <span class="mt-0.5 flex items-center gap-1.5 text-xs text-slate-400 font-mono">
                    {{ product.brand }} · {{ product.id }}
                    <span v-if="product.specifications?.['官方型号']" class="rounded bg-slate-100 px-1 py-0.5 text-slate-600">
                      {{ product.specifications['官方型号'] }}
                    </span>
                  </span>
                </div>
              </div>
            </td>
            <td class="px-4 py-4 text-slate-600">
              <span class="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                {{ product.category }}
              </span>
            </td>
            <td class="px-4 py-4 font-medium text-slate-800">
              {{ product.suggestedPrice || '未定价' }}
            </td>
            <td class="px-4 py-4">
              <a
                v-if="getManualPath(product)"
                :href="getManualPath(product)!"
                target="_blank"
                download
                class="inline-flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700 hover:underline"
                title="预览或下载电子说明书"
              >
                <BookOpen :size="13" /> PDF 文档
              </a>
              <span v-else class="text-xs text-slate-300">未配置</span>
            </td>
            <td class="px-4 py-4 text-slate-500 text-xs">
              {{ Object.keys(product.specifications || {}).length }} 项参数
            </td>
            <td class="px-4 py-4">
              <span class="ui-badge" :class="product.enabled ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-500'">
                {{ product.enabled ? '已启用' : '已停用' }}
              </span>
            </td>
            <td class="px-3">
              <div class="flex items-center gap-1">
                <button type="button" class="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-teal-600" title="编辑" @click="openEdit(product)">
                  <Pencil :size="15" />
                </button>
                <button type="button" class="rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-600" title="删除" @click="deleteProduct(product)">
                  <Trash2 :size="15" />
                </button>
              </div>
            </td>
          </tr>
          <tr v-if="!loading && !products.length">
            <td colspan="7" class="px-5 py-16 text-center text-sm text-slate-400">暂无产品。</td>
          </tr>
          <tr v-if="loading">
            <td colspan="7" class="px-5 py-16 text-center text-sm text-slate-400">正在加载产品目录…</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Edit / Create Product Modal -->
    <UiDialog v-model:open="dialogOpen" :title="editingId ? '编辑产品配置' : '添加新产品'" description="保存后，官网产品展示与智能客服知识库将同步更新。" size="lg">
      <form class="space-y-6" @submit.prevent="saveProduct">
        <!-- 基础信息 -->
        <div>
          <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">基本信息</h3>
          <div class="grid grid-cols-2 gap-3">
            <label class="grid gap-1.5 ui-label">
              <span>产品 ID <span class="text-red-500">*</span></span>
              <input v-model.trim="form.id" class="ui-input font-mono text-sm" required :disabled="!!editingId" placeholder="例如 xiaomi-fan-1x" />
            </label>
            <label class="grid gap-1.5 ui-label">
              <span>品牌 <span class="text-red-500">*</span></span>
              <input v-model.trim="form.brand" class="ui-input" required placeholder="例如 Xiaomi" />
            </label>
            <label class="col-span-2 grid gap-1.5 ui-label">
              <span>产品名称 <span class="text-red-500">*</span></span>
              <input v-model.trim="form.name" class="ui-input" required placeholder="例如 米家直流变频落地扇 1X" />
            </label>
            <label class="grid gap-1.5 ui-label">
              <span>分类快捷选择</span>
              <select class="ui-input" :value="form.categoryId" @change="onPresetCategoryChange">
                <option v-for="cat in PRESET_CATEGORIES" :key="cat.id" :value="cat.id">
                  {{ cat.name }} ({{ cat.id }})
                </option>
              </select>
            </label>
            <div class="grid grid-cols-2 gap-2">
              <label class="grid gap-1.5 ui-label">
                <span>分类 ID</span>
                <input v-model.trim="form.categoryId" class="ui-input font-mono text-sm" required />
              </label>
              <label class="grid gap-1.5 ui-label">
                <span>分类显示名</span>
                <input v-model.trim="form.category" class="ui-input" required />
              </label>
            </div>
          </div>
        </div>

        <!-- 定价与服务资料 -->
        <div>
          <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">定价与文档配置</h3>
          <div class="grid grid-cols-2 gap-3">
            <label class="grid gap-1.5 ui-label">
              <span>官方指导售价</span>
              <input v-model.trim="form.suggestedPrice" class="ui-input" placeholder="例如 ¥289" />
            </label>
            <label class="grid gap-1.5 ui-label">
              <span>显示排序权重</span>
              <input v-model.number="form.displayOrder" type="number" min="0" class="ui-input" />
            </label>
            <label class="col-span-2 grid gap-1.5 ui-label">
              <span>产品图片 URL</span>
              <input v-model.trim="form.imageUrl" class="ui-input text-xs font-mono" placeholder="https://..." />
            </label>
            <label class="col-span-2 grid gap-1.5 ui-label">
              <span class="flex items-center justify-between">
                <span>电子说明书路径 / PDF 地址</span>
                <span class="text-xs text-slate-400 font-normal">支持本地相对路径如 /manuals/xxx.pdf 或直链</span>
              </span>
              <input v-model.trim="form.manualUrl" class="ui-input text-xs font-mono" placeholder="例如 /manuals/xiaomi-fan-1x.pdf" />
            </label>
          </div>
        </div>

        <!-- 规格与说明书配置 -->
        <div>
          <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">规格参数配置</h3>
          <div class="grid grid-cols-2 gap-3 mb-3">
            <label class="grid gap-1.5 ui-label">
              <span>官方型号</span>
              <input v-model.trim="form.officialModel" class="ui-input font-mono text-sm" placeholder="例如 BPLDS01DM" />
            </label>
            <label class="grid gap-1.5 ui-label">
              <span>包装清单</span>
              <input v-model.trim="form.packageContents" class="ui-input text-sm" placeholder="例如 主机、电源线、说明书" />
            </label>
          </div>
          <label class="grid gap-1.5 ui-label">
            <span class="flex items-center justify-between">
              <span>高级技术参数 (JSON)</span>
              <span class="text-xs text-slate-400 font-normal">键值必须均为字符串</span>
            </span>
            <textarea v-model="specificationsText" class="ui-input min-h-24 resize-y font-mono text-xs" />
            <span v-if="customSpecsError" class="text-xs text-red-600">{{ customSpecsError }}</span>
          </label>
        </div>

        <!-- 文本详情与排障指南 -->
        <div>
          <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">介绍与排障指南 (Markdown)</h3>
          <div class="space-y-3">
            <label class="grid gap-1.5 ui-label">
              <span>一句话摘要 (Summary)</span>
              <textarea v-model.trim="form.summary" class="ui-input min-h-16 resize-y text-sm" placeholder="简要说明产品核心特点与用途" />
            </label>
            <label class="grid gap-1.5 ui-label">
              <span>详细介绍、操作与排障说明 (支持 Markdown 标题与列表)</span>
              <textarea v-model.trim="form.description" class="ui-input min-h-36 resize-y font-mono text-xs leading-relaxed" placeholder="## 产品亮点&#10;## 快速操作与配网&#10;## 常见故障排查" />
            </label>
          </div>
        </div>

        <!-- 状态与保存操作 -->
        <div class="pt-2 border-t border-slate-100 flex items-center justify-between">
          <label class="flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
            <input v-model="form.enabled" type="checkbox" class="size-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500" />
            <span>启用此产品（官网展示与 Agent 均可见）</span>
          </label>
          <div class="flex items-center gap-2">
            <button type="button" class="ui-button" @click="dialogOpen = false">取消</button>
            <button type="submit" class="ui-button ui-button-primary" :disabled="saving">
              {{ saving ? '正在保存…' : '保存产品' }}
            </button>
          </div>
        </div>
      </form>
    </UiDialog>
  </section>
</template>
