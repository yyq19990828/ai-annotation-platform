/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// vitest 字段在 vite 6 的 UserConfig 类型里未直接合并，用类型断言放过。
// `/// <reference types="vitest" />` 已注入运行时 schema。
const config: Parameters<typeof defineConfig>[0] = {
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
  // @ts-expect-error vite 6 typing 不暴露 test 字段；运行时由 vitest 解析
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    css: false,
    exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      reportsDirectory: "./coverage",
      // v0.8.3 · 排除 type-only / 静态数据 / 基础设施 / Konva 画布工具等
      // 不可单元测且无业务逻辑的部分。
      exclude: [
        "src/api/generated/**",
        "src/mocks/**",
        "src/types/**",
        "src/data/**",
        "src/main.tsx",
        "src/index.css",
        "src/vite-env.d.ts",
        "src/pages/Workbench/stage/tools/**",
        "src/pages/Workbench/stage/Stage.tsx",
        "src/pages/Workbench/stage/Minimap.tsx",
        "src/pages/Workbench/stage/Layers.tsx",
        "src/utils/bugReportCapture.ts",
        "src/utils/uploadQueue.ts",
        "src/components/bugreport/**",
        "**/*.config.{ts,js}",
        "**/*.d.ts",
        "e2e/**",
        "dist/**",
      ],
      // v0.8.3 · 切硬阻断：低于 thresholds 时 vitest 退出非 0；codecov.yml frontend
      // informational=false 双重把关，避免覆盖率回退。
      //
      // 当前实测 lines=10.88%（8 个新测试文件 + 167 case），保留 0.88pp 容差防止
      // 抖动；下一版逐步推向 ROADMAP 25% 目标，target 同步上调。
      thresholds: {
        lines: 10,
        statements: 10,
        functions: 30,
        branches: 60,
      },
    },
  },
};

export default defineConfig(config);
