import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vite = resolve(root, "node_modules/vite/bin/vite.js");
let child;
let stopped = false;
let restartTimer;
let failures = 0;

function start() {
  if (stopped) return;
  child = spawn(process.execPath, [vite], { cwd: root, stdio: "inherit" });
  child.once("exit", (code) => {
    if (stopped) return;
    // An occupied port must not trigger an endless startup loop.
    if (code !== 0 && ++failures >= 3) {
      console.error("[禾序官网] 连续启动失败，请检查 8849 端口及终端日志。");
      process.exitCode = 1;
      clearInterval(health);
      return;
    }
    console.warn("[禾序官网] 开发进程退出，1 秒后重启。");
    restartTimer = setTimeout(start, 1000);
  });
  child.once("error", (error) => console.error(`[禾序官网] ${error.message}`));
}

let checking = false;
const health = setInterval(async () => {
  if (checking || stopped || !child || child.exitCode !== null) return;
  checking = true;
  try {
    const response = await fetch("http://127.0.0.1:8849/", {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error("页面未就绪");
    failures = 0;
  } catch {
    console.warn("[禾序官网] 页面暂不可达，请检查终端；现有后台不会被重启。");
  } finally {
    checking = false;
  }
}, 15_000);

function stop() {
  if (stopped) return;
  stopped = true;
  clearInterval(health);
  clearTimeout(restartTimer);
  child?.kill("SIGTERM");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
start();
