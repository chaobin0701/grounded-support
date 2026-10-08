export interface RevealOptions {
  delay?: number;
  distance?: number;
  duration?: number;
}
export interface RevealEnvironment {
  reducedMotion: () => boolean;
  observe: (enter: () => void) => () => void;
  onPreferenceChange: (change: () => void) => () => void;
  onFocus: (focus: () => void) => () => void;
  animate: (options: Required<RevealOptions>) => () => void;
}
function clamp(value: number | undefined, fallback: number, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value)) : fallback;
}
export function revealOptions(options: RevealOptions = {}): Required<RevealOptions> {
  return {
    delay: clamp(options.delay, 0, 0, 0.18),
    distance: clamp(options.distance, 20, 8, 28),
    duration: clamp(options.duration, 0.7, 0.4, 1),
  };
}

// Content remains visible before observation; animation is a progressive enhancement.
export function createViewportReveal(options: RevealOptions, env: RevealEnvironment) {
  if (env.reducedMotion()) return () => {};
  let disposed = false;
  let played = false;
  let stopObserver: (() => void) | undefined;
  let stopAnimation: (() => void) | undefined;
  function settle() {
    played = true;
    stopObserver?.();
    stopAnimation?.();
    stopAnimation = undefined;
  }
  const stopPreference = env.onPreferenceChange(() => {
    if (env.reducedMotion()) settle();
  });
  const stopFocus = env.onFocus(settle);
  stopObserver = env.observe(() => {
    if (disposed || played) return;
    played = true;
    stopObserver?.();
    if (!env.reducedMotion()) stopAnimation = env.animate(revealOptions(options));
  });
  return () => {
    if (disposed) return;
    disposed = true;
    settle();
    stopPreference();
    stopFocus();
  };
}
