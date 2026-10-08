import { watch } from "vue";
import type { Router } from "vue-router";
import type { ChatStore } from "./store.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function assistantLocation(id: string | null) {
  return { name: "assistant", params: { conversationId: id || undefined } };
}

// The URL is only a locator. Messages/runs still require the browser's visitor Cookie.
// Navigation never starts or aborts a model request.
export function bindChatRoute(router: Router, chat: ChatStore) {
  let navigating = false;
  const removeGuard = router.beforeEach(async (to, from) => {
    if (to.name !== "assistant") return;
    const raw = to.params.conversationId;
    const id = typeof raw === "string" && raw ? raw : null;
    if (id && !uuid.test(id)) {
      chat.state.notice = "会话链接无效，请从最近会话中选择。";
      return assistantLocation(chat.state.activeId);
    }
    // Full-page entry during streaming must use the existing state/stream.
    if (chat.busy() && chat.state.ready) {
      if (id !== chat.state.activeId) {
        chat.state.notice = "当前回答仍在处理中，请稍后切换会话。";
        return assistantLocation(chat.state.activeId);
      }
      return;
    }
    navigating = true;
    try {
      const alreadyInitializing = chat.state.ready || chat.state.loading;
      await chat.initialize(id || undefined);
      if (id && id !== chat.state.activeId && alreadyInitializing) {
        await chat.openConversation(id);
      } else if (!id && from.name === "assistant" && from.params.conversationId) {
        chat.newConversation();
      }
      if (id !== chat.state.activeId) {
        return assistantLocation(chat.state.activeId);
      }
    } finally {
      navigating = false;
    }
  });
  const stop = watch(
    () => [router.currentRoute.value.fullPath, chat.state.activeId, chat.state.ready],
    () => {
      const route = router.currentRoute.value;
      if (navigating || route.name !== "assistant" || !chat.state.ready) return;
      const id = route.params.conversationId || null;
      if (id !== chat.state.activeId) {
        void router.replace(assistantLocation(chat.state.activeId));
      }
    },
  );
  return () => {
    removeGuard();
    stop();
  };
}
