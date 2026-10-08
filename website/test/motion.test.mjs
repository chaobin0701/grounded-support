import test from "node:test";
import assert from "node:assert/strict";
import { createViewportReveal, revealOptions } from "../src/motion/reveal.ts";
import { welcomeMotion } from "../src/motion/welcome.ts";
function revealFixture(reduced = false) {
  const calls = { animations: [], animationStops: 0, observerStops: 0, preferenceStops: 0, focusStops: 0 };
  const listeners = {};
  const env = {
    reducedMotion: () => reduced,
    observe: (enter) => { listeners.enter = enter; return () => { calls.observerStops++; }; },
    onPreferenceChange: (change) => { listeners.change = change; return () => { calls.preferenceStops++; }; },
    onFocus: (focus) => { listeners.focus = focus; return () => { calls.focusStops++; }; },
    animate: (options) => { calls.animations.push(options); return () => { calls.animationStops++; }; },
  };
  return { calls, listeners, env, reduce: () => { reduced = true; listeners.change?.(); } };
}
test("入镜只播放一次，之前保持原内容；延迟和位移有上限", () => {
  const f = revealFixture();
  const dispose = createViewportReveal({ delay: 100, distance: 100 }, f.env);
  assert.equal(f.calls.animations.length, 0);
  f.listeners.enter();
  f.listeners.enter();
  assert.deepEqual(f.calls.animations, [{ delay: 0.18, distance: 28, duration: 0.7 }]);
  dispose();
  assert.equal(f.calls.animationStops, 1);
  assert.equal(f.calls.preferenceStops, 1);
  assert.equal(f.calls.focusStops, 1);
});
test("减少动效设置下不监听、不隐藏、不播放；非法参数回退", () => {
  const f = revealFixture(true);
  createViewportReveal({}, f.env)();
  assert.deepEqual(f.listeners, {});
  assert.deepEqual(revealOptions({ delay: NaN, distance: Infinity, duration: -10 }), { delay: 0, distance: 20, duration: 0.4 });
});
test("入镜动画运行中改变减少动效设置立即恢复样式，不再次播放", () => {
  const f = revealFixture();
  const dispose = createViewportReveal({}, f.env);
  f.listeners.enter();
  f.reduce();
  f.listeners.enter();
  assert.equal(f.calls.animations.length, 1);
  assert.equal(f.calls.animationStops, 1);
  dispose();
  assert.equal(f.calls.animationStops, 1);
});
test("键盘聚焦立即显现；卸载后延迟入镜回调不会创建动画", () => {
  const f = revealFixture();
  const dispose = createViewportReveal({}, f.env);
  f.listeners.focus();
  f.listeners.enter();
  assert.equal(f.calls.animations.length, 0);
  dispose(); dispose();
  f.listeners.enter();
  assert.equal(f.calls.preferenceStops, 1);
  assert.equal(f.calls.focusStops, 1);
});
test("欢迎区整体淡入上移，顺序短暂交错，四个快捷问题也在 0.7 秒内完成", () => {
  const stages = Object.values(welcomeMotion);
  assert.deepEqual(stages.map((stage) => stage.start), [0, 0.08, 0.16, 0.24]);
  for (const stage of stages) {
    assert.ok(stage.y > 0 && stage.y <= 12);
    assert.ok(stage.duration <= 0.38);
  }
  const last = welcomeMotion.questions;
  assert.ok(last.start + last.duration + last.stagger * 3 <= 0.7);
});
