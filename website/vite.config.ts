import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxy = {
    "/api": {
      // The Docker API is intentionally not exposed on the host. Reuse the
      // management web server's reverse proxy during local website development.
      target: env.API_PROXY_TARGET || "http://127.0.0.1:8081",
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
