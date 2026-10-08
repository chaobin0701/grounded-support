import { gsap } from "gsap";
import type { ObjectDirective } from "vue";
import { createViewportReveal, type RevealOptions } from "./reveal.ts";

const cleanups = new WeakMap<HTMLElement, () => void>();
export const revealDirective: ObjectDirective<HTMLElement, RevealOptions | undefined> = {
  mounted(element, binding) {
    if (typeof window === "undefined" || !window.IntersectionObserver || !window.matchMedia) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const dispose = createViewportReveal(binding.value || {}, {
      reducedMotion: () => preference.matches,
      observe(enter) {
        const observer = new IntersectionObserver((entries) => {
          if (entries.some((entry) => entry.isIntersecting)) enter();
        }, { threshold: 0, rootMargin: "0px 0px -24px 0px" });
        observer.observe(element);
        return () => observer.disconnect();
      },
      onPreferenceChange(change) {
        preference.addEventListener("change", change);
        return () => preference.removeEventListener("change", change);
      },
      onFocus(focus) {
        element.addEventListener("focusin", focus);
        return () => element.removeEventListener("focusin", focus);
      },
      animate(options) {
        let context: gsap.Context | undefined;
        context = gsap.context(() => {
          gsap.fromTo(element, { opacity: 0, y: options.distance }, {
            opacity: 1,
            y: 0,
            delay: options.delay,
            duration: options.duration,
            ease: "power2.out",
            onComplete() {
              // Restore styles so normal hover/height changes are not constrained by GSAP.
              context?.revert();
              context = undefined;
            },
          });
        });
        return () => {
          context?.revert();
          context = undefined;
        };
      },
    });
    cleanups.set(element, dispose);
  },
  beforeUnmount(element) {
    cleanups.get(element)?.();
    cleanups.delete(element);
  },
};
