<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { ArrowUpRight, Bot, Plus, X } from "@lucide/vue";
import { chat } from "../chat/service";
import ChatWorkspace from "./ChatWorkspace.vue";
const route = useRoute();
const dialog = ref<HTMLElement | null>(null);
const launcher = ref<HTMLButtonElement | null>(null);
const mobile = ref(window.matchMedia("(max-width: 600px)").matches);
let returnFocus: HTMLElement | null = null;
let savedOverflow: string | null = null;
function lock() {
  if (mobile.value && chat.state.widgetOpen) {
    if (savedOverflow === null) savedOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  } else if (savedOverflow !== null) {
    document.body.style.overflow = savedOverflow;
    savedOverflow = null;
  }
}
function resize() {
  mobile.value = window.matchMedia("(max-width: 600px)").matches;
  lock();
}
function close() {
  chat.closeWidget();
}
function keyboard(event: KeyboardEvent) {
  if (!chat.state.widgetOpen) return;
  if (event.key === "Escape") {
    event.preventDefault();
    close();
  }
  if (event.key === "Tab" && mobile.value && dialog.value) {
    const targets = [
      ...dialog.value.querySelectorAll<HTMLElement>(
        'button:not(:disabled),a[href],textarea:not(:disabled),[tabindex="0"]',
      ),
    ].filter((node) => node.getClientRects().length);
    const first = targets[0];
    const last = targets.at(-1);
    if (
      event.shiftKey &&
      (document.activeElement === first ||
        !dialog.value.contains(document.activeElement))
    ) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
}
watch(
  () => chat.state.widgetOpen,
  async (open) => {
    if (open)
      returnFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    lock();
    await nextTick();
    if (open) {
      dialog.value
        ?.querySelector<HTMLElement>("textarea:not(:disabled),button")
        ?.focus();
    } else if (route.path !== "/assistant") {
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      else launcher.value?.focus({ preventScroll: true });
    }
  },
);
watch(
  () => route.path,
  (path) => {
    if (path === "/assistant") close();
  },
);
onMounted(() => {
  window.addEventListener("keydown", keyboard);
  window.addEventListener("resize", resize);
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", keyboard);
  window.removeEventListener("resize", resize);
  if (savedOverflow !== null) document.body.style.overflow = savedOverflow;
});
</script>
<template>
  <template v-if="route.path !== '/assistant'">
    <button
      ref="launcher"
      class="assistant-launcher"
      type="button"
      :aria-expanded="chat.state.widgetOpen"
      aria-controls="assistant-window"
      aria-label="打开禾序 AI 助手"
      @click="chat.state.widgetOpen ? close() : chat.openWidget()"
    >
      <Bot :size="24" /><span>在线咨询</span>
    </button>
    <Teleport to="body">
      <Transition name="assistant-window"
        ><div
          v-if="chat.state.widgetOpen"
          class="assistant-overlay"
          :class="{ 'assistant-overlay--mobile': mobile }"
        >
          <button
            v-if="mobile"
            class="assistant-backdrop"
            type="button"
            tabindex="-1"
            aria-label="收起聊天窗口"
            @click="close"
          />
          <section
            id="assistant-window"
            ref="dialog"
            class="assistant-window"
            role="dialog"
            :aria-modal="mobile ? 'true' : undefined"
            aria-labelledby="assistant-window-title"
          >
            <header class="assistant-window-header">
              <div>
                <Bot :size="21" />
                <h2 id="assistant-window-title">禾序 AI 助手</h2>
              </div>
              <nav aria-label="聊天窗口操作">
                <button
                  type="button"
                  aria-label="新建会话"
                  title="新建会话"
                  :disabled="chat.busy()"
                  @click="chat.newConversation()"
                >
                  <Plus :size="18" /></button
                ><RouterLink
                  to="/assistant"
                  aria-label="完整助手"
                  title="完整助手"
                  @click="close"
                  ><ArrowUpRight :size="18" /></RouterLink
                ><button
                  type="button"
                  aria-label="关闭聊天窗口"
                  title="关闭"
                  @click="close"
                >
                  <X :size="19" />
                </button>
              </nav>
            </header>
            <ChatWorkspace mode="widget" />
          </section></div
      ></Transition>
    </Teleport>
  </template>
</template>
