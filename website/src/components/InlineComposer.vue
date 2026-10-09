<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { PRODUCT_TOKEN, clipboardText, encodeDocument, moveReference, normalizeDocument, parseClipboardDocument, replaceDocument, sliceDocument, type InlineDocument, type InlineProduct } from "../chat/inline-document";
import { editorSelection, readEditor, renderEditor, setEditorSelection } from "../chat/inline-editor-dom";
import { resizeComposer } from "../chat/composer";
import type { ProductSelection } from "../chat/product-reference";

const props = defineProps<{
  id: string; text: string; products: InlineProduct[]; disabled: boolean; referencesDisabled: boolean;
  documentKey: string; expanded: boolean; listId?: string; activeDescendant?: string;
}>();
type Caret = { value: string; selectionStart: number; selectionEnd: number; composing: boolean };
const emit = defineEmits<{ change: [document: InlineDocument]; caret: [caret: Caret]; keydown: [event: KeyboardEvent]; compact: [compact: boolean]; notice: [text: string] }>();
const element = ref<HTMLElement | null>(null);
const empty = ref(true);
let composing = false, draggingId = "", lastSelection = { from: 0, to: 0 };
let lastDocumentKey: string | undefined;
let snapshots: Array<{ document: InlineDocument; from: number; to: number }> = [], historyIndex = 0;
const CLIPBOARD_TYPE = "application/x-hexu-product-references";
function current() { return normalizeDocument(props.text, props.products); }
function selected() { return element.value && editorSelection(element.value) || lastSelection; }
function measure() { if (element.value) emit("compact", resizeComposer(element.value)); }
function syncPlaceholder() {
  if (!element.value) return;
  const doc = readEditor(element.value);
  empty.value = !doc.text && !doc.products.length;
  // IME text exists in the DOM before it is committed to the parent draft.
  element.value.dataset.empty = String(empty.value);
}
function caret() {
  if (!element.value) return;
  const selection = editorSelection(element.value);
  if (selection) lastSelection = selection;
  emit("caret", { value: encodeDocument(readEditor(element.value)), selectionStart: lastSelection.from, selectionEnd: lastSelection.to, composing });
}
function remember(doc: InlineDocument, selection = lastSelection) {
  if (JSON.stringify(snapshots[historyIndex]?.document) === JSON.stringify(doc)) return;
  snapshots = snapshots.slice(0, historyIndex + 1);
  snapshots.push({ document: doc, ...selection });
  if (snapshots.length > 100) snapshots.shift();
  historyIndex = snapshots.length - 1;
}
function commit(doc: InlineDocument, selection: { from: number; to: number }, record = true) {
  if (!element.value) return false;
  doc = normalizeDocument(doc.text, doc.products);
  if (doc.text.length > 2000) { emit("notice", "问题最多输入 2000 个字符"); return false; }
  if (props.referencesDisabled && JSON.stringify(doc.products.map(p => p.id).sort()) !== JSON.stringify(props.products.map(p => p.id).sort())) return false;
  renderEditor(element.value, doc, props.referencesDisabled);
  syncPlaceholder();
  element.value.focus(); setEditorSelection(element.value, selection.from, selection.to);
  lastSelection = selection;
  if (record) remember(doc, selection);
  emit("change", doc); measure(); caret(); return true;
}
function replace(insert: InlineDocument, range = selected()) {
  const doc = element.value ? readEditor(element.value) : current();
  const removed = sliceDocument(doc, range.from, range.to);
  if (props.referencesDisabled && removed.products.length) return false;
  const next = replaceDocument(doc, range.from, range.to, insert);
  if (new Set([...doc.products.filter(p => !removed.products.some(r => r.id === p.id)), ...insert.products].map(p => p.id)).size > 5) {
    emit("notice", "一次最多关联 5 个产品"); return false;
  }
  const position = range.from + encodeDocument(insert).length;
  return commit(next, { from: position, to: position });
}
function insertProduct(selection: ProductSelection) {
  if (props.disabled || props.referencesDisabled) return false;
  return replace({ text: "", products: [{ id: selection.product.id, name: selection.product.name, offset: 0 }] }, selection.replace || selected());
}
function input() {
  syncPlaceholder();
  if (!element.value || composing) return;
  const doc = normalizeDocument(readEditor(element.value).text, readEditor(element.value).products);
  lastSelection = editorSelection(element.value) || lastSelection;
  if (doc.text.length > 2000) { commit(current(), lastSelection, false); emit("notice", "问题最多输入 2000 个字符"); return; }
  remember(doc); emit("change", doc); measure(); caret();
}
function history(direction: number) {
  const next = historyIndex + direction;
  if (next < 0 || next >= snapshots.length) return;
  const snapshot = snapshots[next]!;
  if (commit(snapshot.document, { from: snapshot.from, to: snapshot.to }, false)) historyIndex = next;
}
function keyboard(event: KeyboardEvent) {
  if (composing || event.isComposing || event.keyCode === 229) return;
  if ((event.ctrlKey || event.metaKey) && ["z", "y"].includes(event.key.toLowerCase())) {
    event.preventDefault(); event.stopPropagation(); history(event.key.toLowerCase() === "y" || event.shiftKey ? 1 : -1); return;
  }
  emit("keydown", event);
  if (event.defaultPrevented) return;
  const range = selected(), encoded = element.value ? encodeDocument(readEditor(element.value)) : "";
  if (event.key === "Backspace" || event.key === "Delete") {
    if (range.from !== range.to) {
      event.preventDefault(); replace({ text: "", products: [] }, range);
    } else {
      const at = event.key === "Backspace" ? range.from - 1 : range.from;
      if (encoded[at] === PRODUCT_TOKEN) { event.preventDefault(); replace({ text: "", products: [] }, { from: at, to: at + 1 }); }
    }
  } else if (event.key === "Enter") {
    event.preventDefault(); replace({ text: "\n", products: [] });
  }
}
function beforeInput(event: InputEvent) {
  if (composing || event.isComposing) return;
  if (event.inputType === "historyUndo" || event.inputType === "historyRedo") { event.preventDefault(); history(event.inputType === "historyUndo" ? -1 : 1); return; }
  if (event.inputType === "insertParagraph" || event.inputType === "insertLineBreak") { event.preventDefault(); replace({ text: "\n", products: [] }); return; }
  const range = selected();
  if (element.value && (event.inputType === "deleteContentBackward" || event.inputType === "deleteContentForward")) {
    const encoded = encodeDocument(readEditor(element.value));
    const at = event.inputType === "deleteContentBackward" ? range.from - 1 : range.from;
    if (range.from !== range.to || encoded[at] === PRODUCT_TOKEN) {
      event.preventDefault(); replace({ text: "", products: [] }, range.from === range.to ? { from: at, to: at + 1 } : range); return;
    }
  }
  if (props.referencesDisabled && element.value && sliceDocument(readEditor(element.value), range.from, range.to).products.length) event.preventDefault();
}
function compositionStart() { composing = true; syncPlaceholder(); }
function compositionEnd() { composing = false; input(); }
function copy(event: ClipboardEvent, cut = false) {
  if (!element.value || !event.clipboardData) return;
  const range = selected();
  if (range.from === range.to) return;
  const doc = sliceDocument(readEditor(element.value), range.from, range.to);
  if (cut && props.referencesDisabled && doc.products.length) { event.preventDefault(); return; }
  event.preventDefault();
  event.clipboardData.setData("text/plain", clipboardText(doc));
  event.clipboardData.setData(CLIPBOARD_TYPE, JSON.stringify({ version: 1, ...doc }));
  if (cut) replace({ text: "", products: [] }, range);
}
function paste(event: ClipboardEvent) {
  event.preventDefault();
  if (!event.clipboardData) return;
  const doc = parseClipboardDocument(event.clipboardData.getData(CLIPBOARD_TYPE)) || { text: event.clipboardData.getData("text/plain"), products: [] };
  replace(doc);
}
function dragStart(event: DragEvent) {
  const token = (event.target as Element).closest<HTMLElement>("[data-product-id]");
  if (!token || props.referencesDisabled || !event.dataTransfer) { event.preventDefault(); return; }
  draggingId = token.dataset.productId!; event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", token.dataset.productName || draggingId);
}
function drop(event: DragEvent) {
  event.preventDefault();
  if (!element.value || props.disabled) return;
  const document = element.value.ownerDocument as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null; caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
  let range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
  if (!range) { const point = document.caretPositionFromPoint?.(event.clientX, event.clientY); if (point) { range = document.createRange(); range.setStart(point.offsetNode, point.offset); range.collapse(true); } }
  if (range && element.value.contains(range.startContainer)) { const selection = document.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); lastSelection = editorSelection(element.value) || lastSelection; }
  if (draggingId) {
    const moved = moveReference(readEditor(element.value), draggingId, lastSelection.from);
    if (moved && !props.referencesDisabled) commit(moved.document, { from: moved.caret, to: moved.caret });
  } else replace({ text: event.dataTransfer?.getData("text/plain") || "", products: [] });
  draggingId = "";
}
function external() {
  if (!element.value || composing) return;
  const doc = current(), changed = JSON.stringify(normalizeDocument(readEditor(element.value).text, readEditor(element.value).products)) !== JSON.stringify(doc);
  if (!changed && snapshots.length && lastDocumentKey === props.documentKey) return;
  lastDocumentKey = props.documentKey;
  const hadFocus = element.value.contains(element.value.ownerDocument.activeElement);
  renderEditor(element.value, doc, props.referencesDisabled);
  syncPlaceholder();
  lastSelection = { from: encodeDocument(doc).length, to: encodeDocument(doc).length };
  snapshots = [{ document: doc, ...lastSelection }]; historyIndex = 0;
  if (hadFocus) setEditorSelection(element.value, lastSelection.from);
  measure();
}
function selectionChanged() { if (element.value && element.value.contains(element.value.ownerDocument.getSelection()?.anchorNode || null)) caret(); }
// Reconcile after the parent has applied the emitted document, in the same flush.
// An extra nextTick can replay stale props over a subsequent keystroke/undo.
watch(() => [props.text, JSON.stringify(props.products), props.documentKey], external, { flush: "post" });
watch(() => props.referencesDisabled, () => {
  if (!element.value || composing) return;
  const range = selected(); renderEditor(element.value, current(), props.referencesDisabled);
  syncPlaceholder();
  if (element.value === element.value.ownerDocument.activeElement) setEditorSelection(element.value, range.from, range.to);
}, { flush: "post" });
onMounted(() => { external(); measure(); document.addEventListener("selectionchange", selectionChanged); window.addEventListener("resize", measure); });
onBeforeUnmount(() => { document.removeEventListener("selectionchange", selectionChanged); window.removeEventListener("resize", measure); });
defineExpose({ element, insertProduct, focus: () => element.value?.focus(), measure, caret });
</script>
<template>
  <div :id="id" ref="element" class="chat-inline-editor" :contenteditable="disabled ? 'false' : 'true'" role="combobox"
    aria-label="输入问题，可输入 / 引用产品" aria-multiline="true" aria-autocomplete="list" aria-haspopup="listbox"
    :aria-disabled="disabled" :aria-expanded="expanded" :aria-controls="expanded ? listId : undefined" :aria-activedescendant="activeDescendant"
    data-placeholder="输入问题…" :data-empty="empty" spellcheck="false"
    @keydown="keyboard" @keyup="caret" @click="caret" @input="input" @beforeinput="beforeInput"
    @compositionstart="compositionStart" @compositionend="compositionEnd" @copy="copy($event)" @cut="copy($event, true)" @paste="paste"
    @dragstart="dragStart" @dragover.prevent @drop="drop" @dragend="draggingId = ''" />
</template>
