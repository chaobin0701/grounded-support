<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import { Check, ChevronRight, LoaderCircle, Package, Plus, Search, X } from "@lucide/vue";
import { fetchProducts, type Product } from "../catalog";
import { createProductReferencePicker, productSubtitle, type ProductSelection } from "../chat/product-reference";
import ProductImage from "./ProductImage.vue";

const props = defineProps<{
  selected: Array<{ id: string; name: string }>;
  disabled: boolean;
  draft: string;
  composer: HTMLElement | null;
}>();
const emit = defineEmits<{ select: [selection: ProductSelection] }>();
const picker = createProductReferencePicker(fetchProducts, () => props.selected.map(product => product.id), () => props.disabled);
const { state } = picker;
const id = `product-reference-${useId()}`;
const root = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const search = ref<HTMLInputElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const addAction = ref<HTMLButtonElement | null>(null);
const menuOpened = ref(false);
const availableHeight = ref(340);
const rows = computed(picker.rows);
const optionId = (productId: string) => `${id}-${encodeURIComponent(productId)}`;
const activeDescendant = computed(() => state.opened && state.activeId ? optionId(state.activeId) : undefined);
let observer: ResizeObserver | undefined;

function measure() {
  const composer = root.value?.closest(".chat-composer");
  const workspace = root.value?.closest(".chat-workspace");
  if (composer && workspace) {
    const top = Math.max(workspace.getBoundingClientRect().top, window.visualViewport?.offsetTop || 0);
    availableHeight.value = Math.max(0, composer.getBoundingClientRect().top - top - 8);
  }
}
async function toggle() {
  if (props.disabled) return;
  if (state.opened || menuOpened.value) { close(true); return; }
  menuOpened.value = true;
  await nextTick();
  addAction.value?.focus();
}
async function browse() {
  menuOpened.value = false;
  picker.openBrowse();
  await nextTick();
  measure();
  // On touch devices opening the catalogue should not summon the keyboard.
  // Users can still tap the search field when they want to filter products.
  if (!window.matchMedia("(max-width: 600px)").matches) search.value?.focus();
}
function close(focus = false) {
  const slash = state.opened && state.source === "slash";
  menuOpened.value = false;
  picker.close();
  if (focus) (slash ? props.composer : trigger.value)?.focus();
}
function select(product: Product) {
  const selection = picker.selection(product, props.draft);
  if (!selection) return;
  emit("select", selection);
  picker.close();
}
function keyboard(event: KeyboardEvent) {
  if (menuOpened.value && ["Escape", "ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    event.preventDefault(); event.stopPropagation();
    if (event.key === "Escape") close(true); else addAction.value?.focus();
    return true;
  }
  // Retry/close buttons keep their native Enter/Space action; only text inputs navigate the list.
  if (event.target instanceof HTMLButtonElement && event.key !== "Escape") return false;
  const action = picker.key(event.key, { composing: event.isComposing || event.keyCode === 229, shift: event.shiftKey });
  if (!action.handled) return false;
  event.preventDefault(); event.stopPropagation();
  if (action.product) select(action.product);
  if (action.closed) close(true);
  return true;
}
function syncInput(element: { value: string; selectionStart: number; selectionEnd: number }, composing = false) {
  picker.syncInput(element.value, element.selectionStart, element.selectionEnd, composing);
  if (state.opened) menuOpened.value = false;
}
function outside(event: PointerEvent) {
  if (!(event.target instanceof Node) || root.value?.contains(event.target)) return;
  if (props.composer?.contains(event.target) && state.source === "slash") return;
  close();
}
function focusOutside(event: FocusEvent) {
  if (!(event.target instanceof Node) || root.value?.contains(event.target)) return;
  if (props.composer?.contains(event.target) && state.source === "slash") return;
  close();
}
watch(() => props.disabled, value => { if (value) close(); });
watch(() => props.selected.map(product => product.id).join("|"), picker.resetActive);
watch(() => state.opened, async value => { if (value) { await nextTick(); measure(); } });
watch(() => state.activeId, async value => {
  if (!value) return;
  await nextTick();
  const options = panel.value?.querySelector<HTMLElement>(".chat-product-options");
  const row = panel.value?.querySelector<HTMLElement>(`[id="${optionId(value)}"]`);
  if (options && row) {
    const top = row.getBoundingClientRect().top - options.getBoundingClientRect().top + options.scrollTop;
    if (top < options.scrollTop) options.scrollTop = top;
    else if (top + row.offsetHeight > options.scrollTop + options.clientHeight) options.scrollTop = top + row.offsetHeight - options.clientHeight;
  }
});
onMounted(() => {
  observer = new ResizeObserver(measure);
  const workspace = root.value?.closest(".chat-workspace");
  const area = root.value?.closest(".chat-composer-area");
  if (workspace) observer.observe(workspace);
  if (area) observer.observe(area);
  document.addEventListener("pointerdown", outside);
  document.addEventListener("focusin", focusOutside);
  window.addEventListener("resize", measure);
  window.visualViewport?.addEventListener("resize", measure);
  window.visualViewport?.addEventListener("scroll", measure);
});
onBeforeUnmount(() => {
  picker.dispose(); observer?.disconnect();
  document.removeEventListener("pointerdown", outside);
  document.removeEventListener("focusin", focusOutside);
  window.removeEventListener("resize", measure);
  window.visualViewport?.removeEventListener("resize", measure);
  window.visualViewport?.removeEventListener("scroll", measure);
});
defineExpose({ syncInput, keyboard, close, opened: computed(() => state.opened), listId: `${id}-list`, activeDescendant });
</script>

<template>
  <div ref="root" class="chat-product-picker">
    <button ref="trigger" class="chat-product-trigger" type="button" :disabled="disabled" aria-label="添加内容" title="添加内容"
      :aria-expanded="menuOpened || state.opened" :aria-controls="menuOpened ? `${id}-menu` : state.opened ? `${id}-panel` : undefined"
      :aria-haspopup="state.opened ? 'dialog' : 'menu'" @keydown="keyboard" @click="toggle">
      <Plus :size="20" />
    </button>
    <Transition name="product-reference">
      <div v-if="menuOpened" :id="`${id}-menu`" class="chat-add-menu" role="menu" aria-label="添加内容" @keydown="keyboard">
        <button ref="addAction" class="chat-add-product" type="button" role="menuitem" @click="browse">
          <Package :size="17" /><span>添加产品</span><ChevronRight :size="14" />
        </button>
      </div>
    </Transition>
    <Transition name="product-reference">
      <section v-if="state.opened" :id="`${id}-panel`" ref="panel" class="chat-product-popover" role="dialog" aria-label="选择引用产品"
        :style="{ maxHeight: `${availableHeight}px` }" @keydown="keyboard">
        <header><span>引用产品</span><button class="chat-product-close" type="button" aria-label="关闭产品选择" @click="close(true)"><X :size="16" /></button></header>
        <label v-if="state.source === 'button'" class="chat-product-search"><Search :size="15" />
          <span class="sr-only">搜索产品名称、品牌或型号</span>
          <input ref="search" type="search" maxlength="80" :value="state.query" placeholder="搜索名称、品牌或型号" role="combobox"
            aria-autocomplete="list" aria-expanded="true" :aria-controls="`${id}-list`" :aria-activedescendant="activeDescendant"
            @input="picker.setQuery(($event.target as HTMLInputElement).value)" />
        </label>
        <p v-else class="chat-product-query">{{ state.query ? `搜索：${state.query}` : '输入名称、品牌或型号筛选' }}</p>
        <div v-if="state.loading" class="chat-product-status" role="status"><LoaderCircle :size="16" class="spinner" />正在加载产品…</div>
        <div v-else-if="state.error" class="chat-product-status" role="alert"><span>{{ state.error }}</span><button type="button" @click="picker.reload">重试</button></div>
        <p v-else-if="!rows.length" class="chat-product-status" role="status">{{ state.query ? '没有匹配产品，换个关键词试试。' : '暂无可引用产品。' }}</p>
        <div :id="`${id}-list`" class="chat-product-options" role="listbox" aria-label="产品列表" :aria-busy="state.loading">
          <template v-if="!state.loading && !state.error">
            <button v-for="product in rows" :id="optionId(product.id)" :key="product.id" class="chat-product-option" type="button"
              role="option" tabindex="-1" :aria-selected="state.activeId === product.id" :aria-disabled="picker.unavailable(product)"
              :disabled="picker.unavailable(product)" :class="{ highlighted: state.activeId === product.id }"
              @pointerdown.prevent @click="select(product)" @pointerenter="!picker.unavailable(product) && (state.activeId = product.id)">
              <ProductImage :src="product.imageUrl" :alt="product.name" />
              <span class="chat-product-option-copy"><strong>{{ product.name }}</strong><small>{{ productSubtitle(product) }}</small></span>
              <span v-if="selected.some(item => item.id === product.id)" class="chat-product-added"><Check :size="13" />已添加</span>
            </button>
          </template>
        </div>
        <footer aria-live="polite"><span>{{ selected.length >= 5 ? '已达 5 个上限，可先移除已选产品' : `已选 ${selected.length}/5` }}</span><span class="chat-product-key-hint">↑↓ 选择 · Enter 添加</span></footer>
      </section>
    </Transition>
  </div>
</template>
