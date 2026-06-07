import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "node_modules",
      "src/api/generated",
      "coverage",
      "playwright-report",
      "test-results",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // The codebase intentionally colocates small helpers/types with components.
      // Splitting every helper into a separate file would add churn without
      // changing runtime behavior, so keep Fast Refresh as a dev-tool concern.
      "react-refresh/only-export-components": "off",
      // 项目当下偏向务实：先放宽这几条最常见的规则，逐步收紧
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["src/**/*.test.{ts,tsx}", "src/**/__tests__/**/*.{ts,tsx}"],
    rules: {
      // Tests use mocked modules and event shims where exact app types add noise.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  // v0.10.12 · CSP style-src 收紧 — 全站 TSX 已迁到 CSS modules / class 切换,
  // 用 lint guard 防止 JSX inline style 回潮. 文件级 disable 仅用于真正必要的
  // CSS custom property 注入逃生口，并应优先改用 useElementStyle。
  {
    files: ["src/**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXAttribute[name.name='style']",
          message:
            "本文件已迁到同名 CSS module。新增样式请加 CSS class; 真正一次性的动态值用 CSS custom property + 局部 eslint-disable-next-line 放行。",
        },
      ],
    },
  },
);
