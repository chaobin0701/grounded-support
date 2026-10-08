import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxy = {
    "/api": {
      target: env.API_PROXY_TARGET || "http://127.0.0.1:3000",
      changeOrigin: true,
    },
  };
  return {
    plugins: [vue()],
    build: { assetsInlineLimit: 0 },
    server: { host: "127.0.0.1", port: 8849, strictPort: true, proxy },
    preview: { proxy },
  };
});
