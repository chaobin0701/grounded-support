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
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "@lucide/vue";
import { chat } from "../chat/service";
const opened = ref(false);
const allOpened = ref(false);
const query = ref("");
const anchor = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const dialog = ref<HTMLDialogElement | null>(null);
const search = ref<HTMLInputElement | null>(null);
const rows = computed(() =>
  [...chat.state.conversations].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  ),
);
const recent = computed(() => rows.value.slice(0, 10));
const filtered = computed(() =>
  rows.value.filter((row) =>
    row.title
      .toLocaleLowerCase()
      .includes(query.value.trim().toLocaleLowerCase()),
  ),
);
function close(focus = false) {
  opened.value = false;
  if (focus) trigger.value?.focus();
}
async function toggle() {
  opened.value = !opened.value;
  if (opened.value) {
    await nextTick();
    anchor.value?.querySelector<HTMLElement>("[data-history-choice]")?.focus();
  }
}
async function select(id: string) {
  close(true);
  allOpened.value = false;
  await chat.openConversation(id);
}
async function refresh() {
  try {
    await chat.refreshList();
  } catch {
    chat.state.notice = "会话列表暂时无法加载，请稍后重试。";
  }
}
function outside(event: PointerEvent) {
  if (event.target instanceof Node && !anchor.value?.contains(event.target))
    close();
}
function keyboard(event: KeyboardEvent) {
  if (event.key === "Escape" && opened.value) {
    event.preventDefault();
    close(true);
  }
}
function date(value: string) {
  const d = new Date(value),
    now = new Date();
  if (!Number.isFinite(d.getTime())) return "";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const prefix =
    d.toDateString() === now.toDateString()
      ? ""
      : d.toDateString() === yesterday.toDateString()
        ? "昨天 "
        : `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} `;
  return (
    prefix +
    d.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
  );
}
watch(allOpened, async (value) => {
  await nextTick();
  if (value) {
    dialog.value?.showModal();
    search.value?.focus();
  } else {
    dialog.value?.close();
    trigger.value?.focus();
  }
});
onMounted(() => {
  document.addEventListener("pointerdown", outside);
  document.addEventListener("keydown", keyboard);
});
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", outside);
  document.removeEventListener("keydown", keyboard);
  dialog.value?.close();
});
</script>
<template>
  <div ref="anchor" class="chat-history-anchor">
    <button
      ref="trigger"
      class="chat-history-trigger"
      type="button"
      :aria-expanded="opened"
      aria-controls="recent-conversations"
      @click="toggle"
    >
      <Clock3 :size="14" />最近会话<ChevronDown
        :size="14"
        :class="{ rotated: opened }"
      />
    </button>
    <section
      v-if="opened"
      id="recent-conversations"
      class="chat-history-popover"
      aria-label="最近会话列表"
    >
      <header>
        <span>最近 10 条</span
        ><button
          class="icon-button"
          type="button"
          aria-label="刷新会话"
          :disabled="chat.busy()"
          @click="refresh"
        >
          <RefreshCw :size="15" />
        </button>
      </header>
      <div class="chat-recent-list">
        <p v-if="!recent.length" class="chat-history-empty">
          {{ chat.state.loading ? "正在加载…" : "暂无会话，开始聊一聊吧。" }}
        </p>
        <button
          v-for="item in recent"
          :key="item.id"
          data-history-choice
          class="chat-recent-row"
          type="button"
          :class="{ active: chat.state.activeId === item.id }"
          :aria-current="chat.state.activeId === item.id ? 'true' : undefined"
          :disabled="chat.busy()"
          :title="item.title"
          @click="select(item.id)"
        >
          <span>{{ item.title }}</span
          ><time :datetime="item.updatedAt">{{ date(item.updatedAt) }}</time
          ><Check
            :size="16"
            :class="{ hidden: chat.state.activeId !== item.id }"
          />
        </button>
      </div>
      <button
        class="chat-history-view-all"
        type="button"
        @click="
          close();
          allOpened = true;
          query = '';
        "
      >
        查看更多会话<ChevronRight :size="16" />
      </button>
    </section>
    <Teleport to="body">
      <dialog
        ref="dialog"
        class="chat-all-dialog"
        aria-labelledby="all-conversation-title"
        @cancel.prevent="allOpened = false"
        @keydown.esc.stop.prevent="allOpened = false"
        @click="$event.target === dialog && (allOpened = false)"
      >
        <header>
          <div>
            <h2 id="all-conversation-title">全部会话</h2>
            <p>{{ rows.length }} 段会话</p>
          </div>
          <button
            type="button"
            class="icon-button"
            aria-label="关闭会话列表"
            @click="allOpened = false"
          >
            <X :size="19" />
          </button>
        </header>
        <label class="chat-history-search"
          ><Search :size="17" /><input
            ref="search"
            v-model="query"
            type="search"
            placeholder="搜索会话"
            aria-label="搜索会话"
        /></label>
        <div class="chat-all-list">
          <p v-if="!filtered.length" class="chat-history-empty">
            {{ query ? "没有找到匹配的会话。" : "暂无历史会话。" }}
          </p>
          <div
            v-for="item in filtered"
            :key="item.id"
            class="chat-all-row"
            :class="{ active: chat.state.activeId === item.id }"
          >
            <button
              type="button"
              :disabled="chat.busy()"
              :title="item.title"
              @click="select(item.id)"
            >
              <span>{{ item.title }}</span
              ><time :datetime="item.updatedAt">{{
                date(item.updatedAt)
              }}</time>
            </button>
            <Check v-if="chat.state.activeId === item.id" :size="16" />
            <button
              type="button"
              class="icon-button chat-history-delete"
              :aria-label="`删除会话：${item.title}`"
              :disabled="chat.busy()"
              @click="chat.removeConversation(item.id)"
            >
              <Trash2 :size="16" />
            </button>
          </div>
        </div>
      </dialog>
    </Teleport>
  </div>
</template>
