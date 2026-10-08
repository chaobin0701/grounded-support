import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import { chat } from "./chat/service";
import { bindChatRoute } from "./chat/route";
import { revealDirective } from "./motion/directive";
import "./style.css";
import "./chat.css";
import "./chat-layout.css";
import "./product-reference.css";

const unbindChatRoute = bindChatRoute(router, chat);
import.meta.hot?.dispose(unbindChatRoute);
createApp(App).directive("reveal", revealDirective).use(router).mount("#app");
