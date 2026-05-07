/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// vitest 字段在 vite 6 的 UserConfig 类型里未直接合并，用类型断言放过。
// `/// <reference types="vitest" />` 已注入运行时 schema。
const config: Parameters<typeof defineConfig>[0] = {
  plugins: [react()],
  // v0.8.8 · 仓库根 `.env` 是前后端共用 SoT。vite 默认从 `apps/web/.env`
  // 读取会与后端 .env 漂移；显式指向仓库根确保 VITE_* 变量与后端 settings 同源。
  envDir: resolve(__dirname, "../../"),
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
      // 用 127.0.0.1 强制 IPv4：CI runner 上 Node 把 localhost 解析成 ::1，但
      // 后端 uvicorn 只绑 IPv4，会触发 ECONNREFUSED ::1:8000。
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://127.0.0.1:8000",
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
        // v0.8.8 · scripts/ 是 build-time 工具脚本（codegen / size-limit），不应进单测覆盖率分母
        "scripts/**",
      ],
      // v0.8.3 · 切硬阻断：低于 thresholds 时 vitest 退出非 0；codecov.yml frontend
      // informational=false 双重把关，避免覆盖率回退。
      //
      // v0.8.5 · lines/statements 推到 25.28%（277 case，新增 9 个 page/component
      // 测试文件覆盖 Dashboard 三页 + Login + Register + InviteUserModal +
      // Histogram + ForgotPassword/ResetPassword + useDashboard hooks）。
      //
      // v0.8.7 · 阈值临时降到 22（实测 22.04%，296+ case）。原因：v0.8.7 引入
      // 8 个新组件 / hook（Captcha / SkipTaskModal / ReviewerMiniPanel /
      // turnstile.ts / useSkipTask / useReviewerTodayMini / observability/metrics
      // / Topbar 跳过分支），分母增长大于新单测覆盖。
      //
      // v0.8.8 · 推回 25%（实测 25.17%，335+ case）。新增 5 个 test 文件 ~35 case：
      // turnstile / useCanvasDraftPersistence / RejectReasonModal /
      // FailedPredictionsPage / useNotificationSocket（含 ws reauth 关键路径）/
      // AnnotationHistoryTimeline；同时把 scripts/** build-time 工具脚本从
      // coverage 分母里排除。
      thresholds: {
        lines: 25,
        statements: 25,
        functions: 30,
        branches: 60,
      },
    },
  },
};

export default defineConfig(config);
