import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // v0.6.5: 拆 vendor chunk，避免 v0.6.4 1.15MB 单 chunk 警告。
        // konva (~150KB) 仅工作台用；react-markdown (~25KB) 仅评论 / 描述弹窗用。
        manualChunks: {
          "vendor-konva": ["konva", "react-konva"],
          "vendor-markdown": ["react-markdown"],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 3000,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:8000",
        ws: true,
      },
    },
  },
});
