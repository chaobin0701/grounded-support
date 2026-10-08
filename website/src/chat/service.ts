import { chatApi } from "./api.ts";
import { createChatStore } from "./store.ts";
let storage: Storage | undefined;
try {
  storage = window.localStorage;
} catch {
  /* Chat can still work without browser storage. */
}
export const chat = createChatStore(chatApi, storage);
// View components never dispose the store. HMR/reload recover through saved run IDs.
import.meta.hot?.dispose(() => chat.dispose());
