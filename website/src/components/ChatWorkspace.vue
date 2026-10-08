<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  ArrowDown,
  ArrowUp,
  Bot,
  Copy,
  LoaderCircle,
  Plus,
  UserRound,
} from "@lucide/vue";
import { chat } from "../chat/service";
import ChatProgress from "./ChatProgress.vue";
import ChatHistoryMenu from "./ChatHistoryMenu.vue";
import ChatMarkdown from "./ChatMarkdown.vue";
import ChatWelcome from "./ChatWelcome.vue";
import ChatQuota from "./ChatQuota.vue";
import ProductReferencePicker from "./ProductReferencePicker.vue";
import InlineComposer from "./InlineComposer.vue";
import UserMessageContent from "./UserMessageContent.vue";
import type { ProductSelection } from "../chat/product-reference";
import { clipboardText, encodeDocument, messageDocument, serializeMessageDocument, type InlineDocument } from "../chat/inline-document";
import { progressStatus, progressSteps } from "../chat/progress";
import ChatCommentary from "./ChatCommentary.vue";
const props = defineProps<{ mode: "widget" | "full" }>();
const { state } = chat;
const list = ref<HTMLElement | null>(null);
const composer = ref<InstanceType<typeof InlineComposer> | null>(null);
const productPicker = ref<InstanceType<typeof ProductReferencePicker> | null>(null);
const encodedDraft = computed(() => encodeDocument({ text: state.draft, products: state.products }));
// Validate the outgoing text, including product names, not the editor's bare text.
const readableDraft = computed(() => serializeMessageDocument({ text: state.draft, products: state.products }).question);
const composerArea = ref<HTMLElement | null>(null);
const compactComposer = ref(true);
const composerHeight = ref(160);
let composerObserver: ResizeObserver | undefined;
let composerWidth = 0;
function fitComposer() {
  if (!composer.value) return;
  composer.value.measure();
}
watch(() => state.draft, () => {
  fitComposer();
  void follow();
}, { flush: "post" });
watch(() => JSON.stringify(state.products), fitComposer, { flush: "post" });
const following = ref(true);
const busy = computed(() => chat.busy());
const currentTitle = computed(
  () =>
    state.conversations.find((item) => item.id === state.activeId)?.title ||
    "新会话",
);
const simpleStatus = computed(() => {
  if (state.recovering) return "正在恢复上一轮回答…";
  return progressStatus(state.progress, Boolean(state.partialAnswer));
});
const hasProcessSteps = computed(() => progressSteps(state.progress).length > 0);
async function follow(force = false) {
  await nextTick();
  if (list.value && (force || following.value))
    list.value.scrollTop = list.value.scrollHeight;
}
function onScroll() {
  if (list.value)
    following.value =
      list.value.scrollHeight - list.value.clientHeight - list.value.scrollTop <
      80;
}
function send() {
  if (productPicker.value?.opened) {
    state.notice = "请先选择产品，或按 Esc 关闭产品列表后发送。";
    return;
  }
  following.value = true;
  void chat.send();
}
function keyboard(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return;
  if (productPicker.value?.keyboard(event)) return;
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    send();
  }
}
function syncProductCommand(caret: { value: string; selectionStart: number; selectionEnd: number; composing: boolean }) {
  productPicker.value?.syncInput(caret, caret.composing);
}
function edit(document: InlineDocument) { chat.setComposer(document.text, document.products); }
function attachProduct(selection: ProductSelection) {
  composer.value?.insertProduct(selection);
}
function newConversation() {
  if (chat.newConversation()) {
    productPicker.value?.close();
    following.value = true;
    composer.value?.focus();
  }
}
async function copy(text: string, kind = "回答") {
  try {
    await navigator.clipboard.writeText(text);
    state.notice = `已复制${kind}`;
  } catch {
    state.notice = "复制失败，请手动选择内容。";
  }
}
async function reloadList() {
  try {
    await chat.refreshList();
    state.error = "";
  } catch {
    state.error = "历史会话暂时无法加载，请稍后重试。";
  }
}
watch(
  () => [
    state.messages.length,
    state.partialAnswer,
    state.progress.length,
    state.recovering,
    state.loading,
  ],
  () => {
    void follow();
  },
);
watch(
  () => state.activeId,
  () => {
    productPicker.value?.close();
    following.value = true;
    void follow(true);
  },
);
onMounted(() => {
  const initialized = state.ready;
  void chat.initialize().then(() => follow(true));
  if (initialized) void chat.refreshQuota();
  fitComposer();
  if (composerArea.value) {
    composerObserver = new ResizeObserver(([entry]) => {
      if (!entry || !composerArea.value) return;
      if (entry.contentRect.width !== composerWidth) {
        composerWidth = entry.contentRect.width;
        fitComposer();
      }
      composerHeight.value = composerArea.value.getBoundingClientRect().height;
      void follow();
    });
    composerObserver.observe(composerArea.value);
  }
  window.addEventListener("resize", fitComposer);
});
onBeforeUnmount(() => {
  composerObserver?.disconnect();
  window.removeEventListener("resize", fitComposer);
});
</script>

<template>
  <div class="chat-workspace" :class="`chat-workspace--${mode}`" :style="{ '--chat-composer-height': `${composerHeight}px` }">
    <section class="chat-main" aria-label="当前对话">
      <div
        ref="list"
        class="chat-messages"
        tabindex="0"
        :aria-label="`聊天记录：${currentTitle}`"
        @scroll="onScroll"
      >
        <div
          v-if="state.loading || state.switching"
          class="chat-loading"
          role="status"
        >
          <LoaderCircle :size="20" class="spinner" />
          <p>正在加载会话…</p>
        </div>
        <ChatWelcome
          v-else-if="
            !state.messages.length && !state.isSending && !state.recovering
          "
          :mode="mode"
          :suggestions="state.suggestions"
          @select="chat.send"
        />
        <template v-else>
          <article
            v-for="message in state.messages"
            :key="message.id"
            class="chat-message"
            :class="`chat-message--${message.role}`"
            :aria-label="message.role === 'user' ? '用户消息' : '助手回答'"
          >
            <span class="chat-avatar" aria-hidden="true"
              ><UserRound v-if="message.role === 'user'" :size="23" /><Bot
                v-else
                :size="24"
            /></span>
            <div class="chat-message-body">
              <ChatProgress
                v-if="message.role === 'assistant' && mode === 'full'"
                :events="message.progressEvents || []"
                settled
              />
              <ChatMarkdown
                v-if="message.role === 'assistant'"
                :text="message.content"
              />
              <UserMessageContent v-else :message="message" />
              <button
                v-if="message.role === 'user'"
                class="chat-copy chat-copy--user"
                type="button"
                aria-label="复制我的消息"
                title="复制消息"
                @click="copy(clipboardText(messageDocument(message.content, message.context)), '消息')"
              >
                <Copy :size="15" />
              </button>
              <template v-if="message.role === 'assistant'">
                <button
                  class="chat-copy"
                  type="button"
                  aria-label="复制回答"
                  @click="copy(message.content)"
                >
                  <Copy :size="15" /><span>复制</span>
                </button>
              </template>
            </div>
          </article>
          <article
            v-if="state.isSending || state.recovering || state.partialAnswer"
            class="chat-message chat-message--assistant chat-pending"
            aria-label="助手回答"
          >
            <span class="chat-avatar" aria-hidden="true"
              ><Bot :size="24"
            /></span>
            <div class="chat-message-body">
              <p v-if="!state.isSending && !state.recovering" class="chat-incomplete">未完成</p>
              <ChatCommentary :events="state.progress" />
              <ChatProgress
                v-if="mode === 'full'"
                :events="state.progress"
                :settled="!state.isSending && !state.recovering"
              />
              <ChatMarkdown
                v-if="state.partialAnswer"
                :text="state.partialAnswer"
              />
              <p
                v-if="(state.isSending || state.recovering) && (mode === 'widget' || state.recovering || !hasProcessSteps || state.partialAnswer)"
                class="chat-generating"
                role="status"
              >
                <LoaderCircle class="spinner" :size="15" />{{ simpleStatus }}
              </p>
            </div>
          </article>
        </template>
      </div>
      <button
        v-if="!following"
        class="chat-scroll-latest"
        type="button"
        @click="
          following = true;
          follow(true);
        "
      >
        <ArrowDown :size="15" />回到最新消息
      </button>
      <div ref="composerArea" class="chat-composer-area">
        <div v-if="state.error" class="chat-error" role="alert">
          <p>{{ state.error }}</p>
          <button
            v-if="
              state.activeId &&
              state.unresolved &&
              !state.recovering &&
              !state.isSending
            "
            type="button"
            @click="chat.checkRecovery()"
          >
            检查上轮状态</button
          ><button
            v-else-if="!state.activeId && !busy"
            type="button"
            @click="reloadList"
          >
            重新连接
          </button>
        </div>
        <div class="chat-toolbar" aria-label="会话操作与额度">
          <template v-if="mode === 'full'">
            <button
              v-if="chat.hasContent()"
              class="button chat-new"
              type="button"
              :disabled="busy"
              @click="newConversation"
            >
              <Plus :size="14" />新建会话
            </button>
            <ChatHistoryMenu />
          </template>
          <ChatQuota />
          <ProductReferencePicker ref="productPicker" :selected="state.products" :disabled="busy || state.unresolved"
            :draft="encodedDraft" :composer="composer?.element || null" @select="attachProduct" />
        </div>
        <form class="chat-composer" :class="{ 'chat-composer--compact': compactComposer, 'chat-composer--with-products': state.products.length }" @submit.prevent="send">
          <InlineComposer ref="composer" :id="`chat-input-${mode}`" :text="state.draft" :products="state.products"
            :document-key="state.activeId || 'new'" :disabled="state.loading || state.switching" :references-disabled="busy || state.unresolved"
            :expanded="productPicker?.opened || false" :list-id="productPicker?.listId" :active-descendant="productPicker?.activeDescendant"
            @change="edit" @caret="syncProductCommand" @keydown="keyboard" @compact="compactComposer = $event" @notice="state.notice = $event" />
          <div class="chat-composer-actions"><button
            type="submit"
            :disabled="busy || state.unresolved || readableDraft.length < 2 || readableDraft.length > 2000"
            aria-label="发送问题"
          >
            <ArrowUp :size="20" />
          </button></div>
        </form>
      </div>
    </section>
  </div>
</template>
