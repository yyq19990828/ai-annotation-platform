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
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      // 项目当下偏向务实：先放宽这几条最常见的规则，逐步收紧
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  // v0.10.11 · CSP style-src 收紧试点 — 已迁到 CSS modules 的文件加禁止 inline
  // style 的 lint guard, 防止后续回潮. ROADMAP §B "CSP style-src nonce 收紧" 后续
  // 把这个 override 的 files 列表逐步扩到全站, 直到可以从 CSP 头里摘掉
  // 'unsafe-inline'. 文件级 disable 用 `// eslint-disable-next-line` 即可单点放行
  // (例如把 CSS custom property 作为内联 style 值传给 child component 的场景).
  {
    files: [
      "src/pages/Projects/sections/*.tsx",
      "src/pages/Dashboard/**/*.tsx",
      "src/pages/Workbench/**/*.tsx",
      "src/pages/AIPreAnnotate/**/*.tsx",
      "src/pages/Admin/**/*.tsx",
      "src/pages/Annotate/**/*.tsx",
      "src/pages/Audit/**/*.tsx",
      "src/pages/Bugs/**/*.tsx",
      "src/pages/Datasets/**/*.tsx",
      "src/pages/Review/**/*.tsx",
      "src/pages/Settings/**/*.tsx",
      "src/pages/Storage/**/*.tsx",
      "src/pages/Users/**/*.tsx",
      "src/components/AnnotationHistoryTimeline.tsx",
      "src/components/Captcha.tsx",
      "src/components/CommandPalette.tsx",
      "src/components/ErrorBoundary.tsx",
      "src/components/PageLoader.tsx",
      "src/components/PerfHud/PerfHud.tsx",
      "src/components/Thumbnail.tsx",
      "src/components/UserPicker.tsx",
      "src/components/badges/BatchStatusBadge.tsx",
      "src/components/bugreport/**/*.tsx",
      "src/components/datasets/**/*.tsx",
      "src/components/projects/**/*.tsx",
      "src/components/routing/RequireProjectMember.tsx",
      "src/components/shell/**/*.tsx",
      "src/components/users/**/*.tsx",
      "src/components/ui/AssigneeAvatarStack.tsx",
      "src/components/ui/Avatar.tsx",
      "src/components/ui/Badge.tsx",
      "src/components/ui/Button.tsx",
      "src/components/ui/Card.tsx",
      "src/components/ui/DropdownMenu.tsx",
      "src/components/ui/Histogram.tsx",
      "src/components/ui/Icon.tsx",
      "src/components/ui/Modal.tsx",
      "src/components/ui/ProgressBar.tsx",
      "src/components/ui/RadialProgress.tsx",
      "src/components/ui/SearchInput.tsx",
      "src/components/ui/SectionDivider.tsx",
      "src/components/ui/Sparkline.tsx",
      "src/components/ui/StatCard.tsx",
      "src/components/ui/TabRow.tsx",
      "src/components/ui/Toast.tsx",
      "src/components/ui/Tooltip.tsx",
    ],
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
