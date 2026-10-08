import { reactive } from "vue";
import type { Product } from "../catalog.ts";

export type ProductCommand = { from: number; to: number; query: string };
export type ProductSelection = { product: Product; draft: string; caret: number | null; replace?: { from: number; to: number } };

function inCode(prefix: string) {
  let fence = "";
  for (const line of prefix.split("\n")) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/u)?.[1];
    if (marker && !fence) fence = marker;
    else if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = "";
  }
  if (fence) return true;
  let ticks = "";
  for (const match of (prefix.split("\n").at(-1) || "").matchAll(/(?<!\\)(`+)/gu)) {
    if (!ticks) ticks = match[1]!;
    else if (match[1] === ticks) ticks = "";
  }
  return Boolean(ticks);
}

// Only an explicit slash token at the caret is a command, never a product name in prose.
export function findProductCommand(text: string, start: number, end = start): ProductCommand | null {
  if (start !== end || start < 0 || start > text.length) return null;
  if (text[start] && !/\s/u.test(text[start]!)) return null;
  const prefix = text.slice(0, start);
  if (inCode(prefix)) return null;
  const match = prefix.match(/(?:^|\s|\uFFFC)\/([^\s/\\`~\uFFFC]{0,80})$/u);
  if (!match || /^\d+(?:[.-]\d*)*$/u.test(match[1]!)) return null;
  return { from: start - match[1]!.length - 1, to: start, query: match[1]! };
}

export function productBrand(brand: string) {
  return brand === "Midea" ? "美的" : brand === "Xiaomi" ? "小米" : brand;
}
export function productSubtitle(product: Product) {
  return `${productBrand(product.brand)} · ${product.specifications["型号"] || product.category}`;
}
function normalized(value: string) { return value.normalize("NFKC").toLocaleLowerCase().trim(); }
export function searchReferenceProducts(products: Product[], query: string) {
  const terms = normalized(query).split(/\s+/u).filter(Boolean);
  return products.filter(product => {
    const haystack = normalized(`${product.id} ${product.name} ${product.brand} ${productSubtitle(product)}`);
    return terms.every(term => haystack.includes(term));
  });
}
const commandKey = (command: ProductCommand) => `${command.from}:${command.to}:${command.query}`;

export function createProductReferencePicker(
  loadProducts: (signal: AbortSignal) => Promise<Product[]>,
  selectedIds: () => string[],
  disabled: () => boolean = () => false,
) {
  const state = reactive({
    opened: false,
    source: "button" as "button" | "slash",
    query: "",
    products: [] as Product[],
    activeId: "" as string,
    loading: false,
    error: "",
    command: null as ProductCommand | null,
  });
  let dismissed = "";
  let controller: AbortController | undefined;
  let disposed = false;
  const rows = () => searchReferenceProducts(state.products, state.query);
  function unavailable(product: Product) {
    const ids = selectedIds();
    return disabled() || state.loading || ids.includes(product.id) || ids.length >= 5;
  }
  function resetActive() {
    state.activeId = rows().find(product => !unavailable(product))?.id || "";
  }
  async function reload() {
    controller?.abort();
    const current = new AbortController();
    controller = current;
    state.loading = true;
    state.activeId = "";
    state.error = "";
    try {
      const products = await loadProducts(current.signal);
      if (!disposed && controller === current && !current.signal.aborted) state.products = products;
    } catch (error) {
      if (!disposed && controller === current && !current.signal.aborted) {
        state.products = [];
        state.error = error instanceof Error ? error.message : "产品目录暂时无法加载，请重试。";
      }
    } finally {
      if (!disposed && controller === current) { state.loading = false; resetActive(); }
    }
  }
  function close(suppress = true) {
    if (suppress && state.command) dismissed = commandKey(state.command);
    state.opened = false;
    state.command = null;
    state.activeId = "";
  }
  function openBrowse() {
    if (disabled()) return;
    state.source = "button";
    state.command = null;
    state.query = "";
    state.opened = true;
    void reload();
  }
  function syncInput(text: string, start: number, end = start, composing = false) {
    if (disabled()) { close(); return; }
    if (composing || (state.opened && state.source === "button")) return;
    const command = findProductCommand(text, start, end);
    if (!command) { dismissed = ""; if (state.source === "slash") close(false); return; }
    if (commandKey(command) === dismissed) return;
    const opening = !state.opened;
    state.source = "slash";
    state.command = command;
    state.opened = true;
    if (state.query !== command.query || opening) { state.query = command.query; resetActive(); }
    if (opening) void reload();
  }
  function setQuery(query: string) { state.query = query; resetActive(); }
  function move(direction: number) {
    const enabled = rows().filter(product => !unavailable(product));
    if (!enabled.length) { state.activeId = ""; return; }
    const current = enabled.findIndex(product => product.id === state.activeId);
    const next = current < 0 ? (direction > 0 ? 0 : enabled.length - 1) : (current + direction + enabled.length) % enabled.length;
    state.activeId = enabled[next]!.id;
  }
  function selection(product: Product, draft: string): ProductSelection | null {
    if (!state.opened || unavailable(product) || !rows().some(row => row.id === product.id)) return null;
    const command = state.source === "slash" ? state.command : null;
    // A stale menu must never delete text that was edited or restored elsewhere.
    if (command && draft.slice(command.from, command.to) !== `/${command.query}`) return null;
    return { product, draft: command ? draft.slice(0, command.from) + draft.slice(command.to) : draft, caret: command?.from ?? null, ...(command ? { replace: { from: command.from, to: command.to } } : {}) };
  }
  function current() { return rows().find(product => product.id === state.activeId); }
  function key(key: string, options: { composing?: boolean; shift?: boolean } = {}): { handled: boolean; product?: Product; closed?: boolean } {
    if (!state.opened || options.composing) return { handled: false };
    if (key === "ArrowDown" || key === "ArrowUp") { move(key === "ArrowDown" ? 1 : -1); return { handled: true }; }
    if (key === "Enter" && !options.shift) return { handled: true, product: current() };
    if (key === "Escape") { close(); return { handled: true, closed: true }; }
    if (key === "Tab") close();
    return { handled: false };
  }
  function dispose() { disposed = true; controller?.abort(); }
  return { state, rows, unavailable, resetActive, reload, close, openBrowse, syncInput, setQuery, move, selection, current, key, dispose };
}
