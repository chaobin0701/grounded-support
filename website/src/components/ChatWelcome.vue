<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Bot } from "@lucide/vue";
import { gsap } from "gsap";
import { welcomeMotion as motion } from "../motion/welcome";
const props = defineProps<{ mode: "widget" | "full"; suggestions: string[] }>();
const emit = defineEmits<{ select: [question: string] }>();
const root = ref<HTMLElement | null>(null);
const icon = ref<HTMLElement | null>(null);
const subtitle = ref<HTMLElement | null>(null);
const title = ref<HTMLElement | null>(null);
let context: gsap.Context | undefined;
let preference: MediaQueryList | undefined;
let mounted = false;
let settled = false;
const buttons = () => Array.from(root.value?.querySelectorAll<HTMLButtonElement>(".chat-suggestions button") || []);

function finish() {
  settled = true;
  context?.revert();
  context = undefined;
}
function preferenceChanged() {
  if (preference?.matches) finish();
}
onMounted(() => {
  mounted = true;
  if (!window.matchMedia) { finish(); return; }
  preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  preference.addEventListener("change", preferenceChanged);
  if (preference.matches || settled) { finish(); return; }
  context = gsap.context(() => {
    gsap.timeline({ defaults: { ease: "power2.out" }, onComplete: finish })
      .fromTo(icon.value, { opacity: 0, y: motion.icon.y, scale: motion.icon.scale },
        { opacity: 1, y: 0, scale: 1, duration: motion.icon.duration }, motion.icon.start)
      .fromTo(title.value, { opacity: 0, y: motion.title.y },
        { opacity: 1, y: 0, duration: motion.title.duration }, motion.title.start)
      .fromTo(subtitle.value, { opacity: 0, y: motion.subtitle.y },
        { opacity: 1, y: 0, duration: motion.subtitle.duration }, motion.subtitle.start)
      .fromTo(buttons(), { opacity: 0, y: motion.questions.y },
        { opacity: 1, y: 0, duration: motion.questions.duration, stagger: motion.questions.stagger }, motion.questions.start);
  }, root.value || undefined);
});
// Presentation data can replace the fallback questions during the intro.
// Settle the short entrance instead of replaying it or hiding replacement buttons.
watch(() => props.suggestions, () => {
  if (!mounted || settled || !context) return;
  finish();
}, { flush: "post" });
onBeforeUnmount(() => {
  mounted = false;
  settled = true;
  context?.revert();
  context = undefined;
  preference?.removeEventListener("change", preferenceChanged);
});
</script>
<template>
  <div ref="root" class="chat-welcome" @focusin="finish" @pointerdown.capture="finish">
    <span ref="icon" class="chat-welcome-icon" aria-hidden="true"><Bot :size="27" /></span>
    <h2 ref="title">你好，我是禾序 AI 助手</h2>
    <p ref="subtitle">
      选购、规格或使用问题，<br v-if="mode === 'widget'" />都可以在这里聊一聊。
    </p>
    <div class="chat-suggestions">
      <button v-for="suggestion in suggestions" :key="suggestion" type="button" @click="emit('select', suggestion)">
        {{ suggestion }}
      </button>
    </div>
  </div>
</template>
