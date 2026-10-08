<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import {
  ArrowDown,
  ArrowUp,
  Bot,
  ChevronDown,
  Copy,
  FileText,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  Trash2,
} from "@lucide/vue";
import { chat } from "../chat/service";
import ChatProgress from "./ChatProgress.vue";
const props = defineProps<{ mode: "widget" | "full" }>();
const { state } = chat;
const list = ref<HTMLElement | null>(null);
const composer = ref<HTMLTextAreaElement | null>(null);
const following = ref(true);
const openMenuId = ref<string | null>(null);
const busy = computed(() => chat.busy());
const currentTitle = computed(
  () =>
    state.conversations.find((item) => item.id === state.activeId)?.title ||
    "新会话",
);
const simpleStatus = computed(() =>
  state.recovering
    ? "正在恢复上一轮回答…"
    : state.progress.some(
          (event) => event.stage === "tool" && event.status === "running",
        )
      ? "正在查询产品资料…"
      : state.progress.some((event) => event.stage === "tool")
        ? "正在整理回答…"
        : "正在生成回答…",
);
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
  following.value = true;
  void chat.send();
}
function keyboard(event: KeyboardEvent) {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    send();
  }
}
function edit(event: Event) {
  chat.setDraft((event.target as HTMLTextAreaElement).value);
}
function newConversation() {
  if (chat.newConversation()) {
    following.value = true;
    composer.value?.focus();
  }
}
function toggleMenu(id: string) {
  openMenuId.value = openMenuId.value === id ? null : id;
}
function closeMenu() {
  openMenuId.value = null;
}
async function remove(id: string) {
  closeMenu();
  await chat.removeConversation(id);
}
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    state.notice = "已复制回答";
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
function select(event: Event) {
  const id = (event.target as HTMLSelectElement).value;
  if (id) void chat.openConversation(id);
  else newConversation();
}
function time(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(date);
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
    following.value = true;
    void follow(true);
  },
);
onMounted(() => {
  void chat.initialize().then(() => follow(true));
  window.addEventListener("click", closeMenu);
});
onBeforeUnmount(() => window.removeEventListener("click", closeMenu));
</script>

<template>
  <div class="chat-workspace" :class="`chat-workspace--${mode}`">
    <aside v-if="mode === 'full'" class="chat-history" aria-label="历史会话">
      <button
        class="button button-primary chat-new"
        type="button"
        :disabled="busy"
        @click="newConversation"
      >
        <Plus :size="17" />新建会话
      </button>
      <div class="chat-history-heading">
        <span>最近会话</span
        ><button type="button" :disabled="busy" @click="reloadList">
          刷新
        </button>
      </div>
      <div class="chat-history-list">
        <p v-if="!state.conversations.length" class="chat-history-empty">
          {{ state.loading ? "正在加载…" : "开始一段新的对话吧。" }}
        </p>
        <div
          v-for="item in state.conversations"
          :key="item.id"
          class="chat-history-item"
          :class="{ active: state.activeId === item.id }"
        >
          <button
            class="chat-history-open"
            type="button"
            :disabled="busy"
            :aria-current="state.activeId === item.id ? 'true' : undefined"
            :title="item.title"
            @click="chat.openConversation(item.id)"
          >
            {{ item.title }}
          </button>
          <button
            class="chat-history-more"
            type="button"
            :disabled="busy"
            :aria-label="`会话操作：${item.title}`"
            :aria-expanded="openMenuId === item.id"
            @click.stop="toggleMenu(item.id)"
          >
            <MoreHorizontal :size="17" />
          </button>
          <div
            v-if="openMenuId === item.id"
            class="chat-history-menu"
            @click.stop
            @keydown.esc="closeMenu"
          >
            <button type="button" @click="remove(item.id)">
              <Trash2 :size="15" />删除会话
            </button>
          </div>
        </div>
      </div>
    </aside>
    <section class="chat-main" aria-label="当前对话">
      <div v-if="mode === 'full'" class="chat-mobile-history">
        <label class="sr-only" for="chat-conversation">选择会话</label>
        <div>
          <select
            id="chat-conversation"
            :value="state.activeId || ''"
            :disabled="busy"
            @change="select"
          >
            <option value="">新会话</option>
            <option
              v-for="item in state.conversations"
              :key="item.id"
              :value="item.id"
            >
              {{ item.title }}
            </option></select
          ><ChevronDown :size="16" aria-hidden="true" />
        </div>
        <button
          class="icon-button"
          type="button"
          aria-label="新建会话"
          :disabled="busy"
          @click="newConversation"
        >
          <Plus :size="19" /></button
        ><button
          v-if="state.activeId"
          class="icon-button"
          type="button"
          aria-label="删除当前会话"
          :disabled="busy"
          @click="remove(state.activeId)"
        >
          <Trash2 :size="17" />
        </button>
      </div>
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
        <div
          v-else-if="
            !state.messages.length && !state.isSending && !state.recovering
          "
          class="chat-welcome"
        >
          <span class="chat-welcome-icon"><Bot :size="27" /></span>
          <h2>你好，我是禾序 AI 助手</h2>
          <p>
            选购、规格或使用问题，<br
              v-if="mode === 'widget'"
            />都可以在这里聊一聊。
          </p>
          <div class="chat-suggestions">
            <button
              v-for="suggestion in state.suggestions"
              :key="suggestion"
              type="button"
              @click="chat.send(suggestion)"
            >
              {{ suggestion }}
            </button>
          </div>
        </div>
        <template v-else>
          <article
            v-for="message in state.messages"
            :key="message.id"
            class="chat-message"
            :class="`chat-message--${message.role}`"
          >
            <div class="chat-message-heading">
              <span>{{ message.role === "user" ? "你" : "禾序 AI 助手" }}</span
              ><time :datetime="message.createdAt">{{
                time(message.createdAt)
              }}</time>
            </div>
            <p class="chat-message-text">{{ message.content }}</p>
            <template v-if="message.role === 'assistant'">
              <div v-if="message.citations.length" class="chat-sources">
                <div
                  v-for="citation in message.citations"
                  :key="citation.chunkId"
                >
                  <FileText :size="14" /><span
                    >来源 ·
                    {{
                      citation.documentTitle || citation.originalFilename
                    }}</span
                  >
                </div>
              </div>
              <button
                class="chat-copy"
                type="button"
                aria-label="复制回答"
                @click="copy(message.content)"
              >
                <Copy :size="15" /><span>复制</span>
              </button>
              <ChatProgress
                v-if="mode === 'full'"
                :events="message.progressEvents || []"
                settled
              />
            </template>
          </article>
          <article
            v-if="state.isSending || state.recovering || state.partialAnswer"
            class="chat-message chat-message--assistant chat-pending"
          >
            <div class="chat-message-heading">
              <span>禾序 AI 助手</span
              ><small v-if="!state.isSending && !state.recovering"
                >未完成</small
              >
            </div>
            <p v-if="state.partialAnswer" class="chat-message-text">
              {{ state.partialAnswer }}
            </p>
            <p
              v-if="state.isSending || state.recovering"
              class="chat-generating"
              role="status"
            >
              <LoaderCircle class="spinner" :size="15" />{{ simpleStatus }}
            </p>
            <div v-if="state.partialCitations.length" class="chat-sources">
              <div
                v-for="citation in state.partialCitations"
                :key="citation.chunkId"
              >
                <FileText :size="14" /><span
                  >来源 ·
                  {{
                    citation.documentTitle || citation.originalFilename
                  }}</span
                >
              </div>
            </div>
            <ChatProgress
              v-if="mode === 'full'"
              :events="state.progress"
              :settled="!state.isSending && !state.recovering"
            />
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
      <div class="chat-composer-area">
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
        <form class="chat-composer" @submit.prevent="send">
          <label class="sr-only" :for="`chat-input-${mode}`">输入问题</label
          ><textarea
            :id="`chat-input-${mode}`"
            ref="composer"
            :value="state.draft"
            rows="2"
            maxlength="2000"
            placeholder="输入你想了解的问题…"
            :disabled="state.loading || state.switching"
            @input="edit"
            @keydown="keyboard"
          ></textarea
          ><button
            type="submit"
            :disabled="busy || state.unresolved || !state.draft.trim()"
            aria-label="发送问题"
          >
            <ArrowUp :size="20" />
          </button>
        </form>
        <p class="chat-composer-note">
          {{
            mode === "full"
              ? "AI 回答仅供参考，请以产品官方资料为准。"
              : "AI 助手 · 请勿发送敏感个人信息"
          }}
        </p>
      </div>
    </section>
  </div>
</template>
