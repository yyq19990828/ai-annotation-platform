import { defineConfig } from "@hey-api/openapi-ts";
import { resolve } from "path";

/**
 * 输入优先级：
 *   1. OPENAPI_URL 环境变量（CI / 自定义场景）
 *   2. 仓库内 apps/api/openapi.snapshot.json（默认；不依赖 API 运行）
 *
 * 刷新 snapshot：
 *   cd apps/api && uv run python ../../scripts/export_openapi.py
 *
 * 输出：src/api/generated/{types.gen.ts, sdk.gen.ts}
 */
export default defineConfig({
  input:
    process.env.OPENAPI_URL ??
    resolve(__dirname, "../api/openapi.snapshot.json"),
  output: {
    path: "src/api/generated",
    format: "prettier",
    lint: "eslint",
  },
  plugins: ["@hey-api/types"],
});
