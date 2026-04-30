import { defineConfig } from "@hey-api/openapi-ts";

/**
 * v0.5.5 phase 2 · A.1：前后端 schema 自动同步基线。
 *
 * 输入：dev API（默认 8000）的 /openapi.json
 * 输出：src/api/generated/{types.gen.ts, sdk.gen.ts}
 *
 * 用法：
 *   pnpm --filter @anno/web codegen           # 生成一次（API 须在运行）
 *   pnpm --filter @anno/web codegen:watch     # 持续同步
 *
 * 渐进迁移路径（不强制 prebuild gate，避免 CI 与 dev 启动循环依赖）：
 *   - 跑一次 codegen 后，把 src/api/users.ts 等手写文件顶部的 `interface UserResponse {...}`
 *     替换为 `export type { UserResponse } from "./generated/types.gen";`
 *   - 后续后端改 schema → 运行 codegen → 提交 generated/ 与手写 axios 包装并行更新
 *   - 等 5 个高频 type 全部切到 generated 后，可考虑加 prebuild gate
 */
export default defineConfig({
  input: process.env.OPENAPI_URL ?? "http://localhost:8000/openapi.json",
  output: {
    path: "src/api/generated",
    format: "prettier",
    lint: "eslint",
  },
  plugins: [
    "@hey-api/typescript",
  ],
});
