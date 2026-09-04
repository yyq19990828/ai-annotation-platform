/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";
import { cspNoncePlugin } from "./vite-plugins/csp-nonce";

// v0.13.2 · dev proxy 目标可配：多 worktree 并行时各分支后端跑在不同端口
// （如点云分支隔离栈 8010），用 API_PROXY_TARGET 覆盖，默认仍指 8000。
const apiTarget = process.env.API_PROXY_TARGET || "http://127.0.0.1:8000";
const wsTarget = apiTarget.replace(/^http/, "ws");
const minioTarget = process.env.MINIO_PROXY_TARGET || "http://127.0.0.1:9000";

// vitest 字段在 vite 6 的 UserConfig 类型里未直接合并，用类型断言放过。
// `/// <reference types="vitest" />` 已注入运行时 schema。
const config: Parameters<typeof defineConfig>[0] = {
  plugins: [react(), tailwindcss(), cspNoncePlugin()],
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
        manualChunks(id) {
          if (/\/node_modules\/(?:react|react-dom|scheduler)\//.test(id)) return "vendor-react";
          if (/\/node_modules\/(?:dockview|dockview-core|dockview-react)\//.test(id))
            return "vendor-dockview";
          if (/\/node_modules\/(?:konva|react-konva)\//.test(id)) return "vendor-konva";
          if (id.includes("/node_modules/react-markdown/")) return "vendor-markdown";
          if (id.includes("/node_modules/three/")) return "vendor-three";
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
  // Both production Workers are module Workers. ES output is also required for
  // the Raster Mask Worker's lazy WebGPU provider chunk.
  worker: {
    format: "es",
  },
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 3000,
    proxy: {
      // 用 127.0.0.1 强制 IPv4：CI runner 上 Node 把 localhost 解析成 ::1，但
      // 后端 uvicorn 只绑 IPv4，会触发 ECONNREFUSED ::1:8000。
      "/api": {
        target: apiTarget,
        changeOrigin: true,
      },
      "/ws": {
        target: wsTarget,
        ws: true,
      },
      // DEV 媒体走与页面同源的 /minio，远程浏览器只需能访问 Vite
      // 端口。转发前去掉前缀，保持 S3 签名的 canonical resource 不变。
      "/minio": {
        target: minioTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/minio/, ""),
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
        // v0.13.12 · Three.js 点云画布 / WebGL 渲染基础设施（ThreeDWorkbench /
        // PointCloudScene / 三视图 / 相机投影视图等）：无业务逻辑、jsdom 无 WebGL
        // 不可单元测，与上方 Konva stage 画布排除同理。stages/three-d/geometry/** 是
        // 纯几何数学，有完整单测，保留在覆盖率分母内。
        "src/pages/Workbench/stages/three-d/*.{ts,tsx}",
        "src/utils/bugReportCapture.ts",
        "src/utils/uploadQueue.ts",
        "src/components/bugreport/**",
        "**/*.config.{ts,js}",
        "**/*.d.ts",
        "e2e/**",
        "dist/**",
        // v0.8.8 · scripts/ 是 build-time 工具脚本（codegen / size-limit），不应进单测覆盖率分母
        "scripts/**",
        // v0.10.48 · 测试文件本身（~100% 自覆盖）不应进分母，否则虚高覆盖率口径。
        // 排除后报告 = 真实源码覆盖率。
        "**/*.test.{ts,tsx}",
        "**/*.spec.{ts,tsx}",
        "**/__tests__/**",
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
      //
      // v0.9.14 · 推到 30%（实测 30.30%，420+ case）。新增 5 个 test 文件 ~30 case：
      // GeneralSection / DatasetsSection / AuditPage / BatchesSection (smoke) +
      // transforms.test multi_polygon 几何映射；同时修 ProjectDetailPanel.test
      // 缺 useUpdateProject mock + useBatchEventsSocket WS 触发 worker crash 回归.
      //
      // v0.10.48 · 两步：① 把测试文件本身（*.test.* / __tests__）从分母排除，
      // 让口径=真实源码覆盖率（此前含测试文件虚高到 52%，真实 38.74%）；
      // ② 新增 12 个 page/组件 test 文件 ~99 case（SettingsPage / UsersPage /
      // StoragePage / DatasetsPage / DashboardPage / ReviewPage / ImportDatasetWizard /
      // CreateProjectWizard / AdminPeoplePage / AIPreAnnotateJobsPage /
      // RegisteredBackendsTab / AIInspectorPanel），真实源码 lines 推到 47.64%。
      // 阈值随之抬到 45（留 ~2.6pt 缓冲防回退）。
      thresholds: {
        lines: 45,
        statements: 45,
        functions: 45,
        branches: 70,
      },
    },
  },
};

export default defineConfig(config);
