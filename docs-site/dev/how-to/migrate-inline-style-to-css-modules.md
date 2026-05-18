# 把页面级 inline style 迁到 CSS modules

::: tip Since v0.10.11
首个试点：`apps/web/src/pages/Projects/sections/BatchesSection.tsx`（17 处 inline → CSS modules）。v0.10.12 已清空 `apps/web/src/**/*.tsx` 的 JSX `style=` / `<style>`，lint guard 已覆盖全站 TSX，CSP 头也已移除 `style-src 'unsafe-inline'`。
:::

## 为什么要迁

[`CSP style-src nonce 收紧`](../../ops/security/) 的前置依赖是全站 ~2900 处 `style={{...}}` 重构。迁移完成后，生产 CSP 已收窄为只接受同源样式表和带 nonce 的 HTML `<style>` 标签（与 v0.9.11 收紧 script-src 同模式）。

后续新增/回归样式必须继续遵守这个约束：用 CSS modules / class 切换；真正动态值用 ref 同步 CSS custom properties，不能重新引入 JSX `style=`。

## 步骤

### 1. 新建 `.module.css` 同名文件

与 TSX 同目录，命名 `<Component>.module.css`：

```text
sections/
  BatchesSection.tsx
  BatchesSection.module.css   ← 新增
```

### 2. 类名约定

- **静态布局类**：语义命名（`.toolbar` / `.viewToggle` / `.tableHeadRow`），不用 `bs-` 前缀（CSS modules 已 scope）。
- **状态变体**：BEM-like 后缀（`.viewToggleButton` + `.viewToggleButtonActive`），TSX 端用 `cn(styles.x, isActive && styles.xActive)` 拼接。
- **Button 覆盖类**：优先使用组件现有 `variant` / `size` / `className` 能力；不要为了覆盖基础 UI 再引入 inline style。
- **真正动态值**：用 CSS custom property，并通过 `useElementStyle` / ref 写入 DOM style，避免 TSX JSX 上出现 `style=`。

### 3. 在 TSX 里 `import styles from "./X.module.css"` 并把 `style={{...}}` 替换成 `className={styles.xxx}`

简单工具函数避免引第三方依赖：

```tsx
function cn(...xs: Array<string | false | null | undefined>): string {
  return xs.filter(Boolean).join(" ");
}
```

### 4. 加 ESLint 文件级 guard

[`apps/web/eslint.config.js`](../../../apps/web/eslint.config.js) 已对 `src/**/*.tsx` 启用 inline-style guard：

```js
{
  files: ["src/**/*.tsx"],
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        selector: "JSXAttribute[name.name='style']",
        message: "本文件已迁到 CSS modules。新增样式请加 CSS class; ...",
      },
    ],
  },
},
```

新增 TSX 文件会自动继承该约束；如确实需要动态样式，先抽 CSS class / CSS var，再用 ref 写入。

### 5. 验证

- `pnpm --filter web typecheck` 干净。
- `pnpm --filter web lint <file>` 干净（lint guard 不报）。
- `pnpm --filter web vitest run` 该 section 既有测试全过（无视觉回归）。
- `rg -n --glob '*.tsx' "style\\s*=|<style" apps/web/src` 无输出。
- preview 实际渲染：进入该 section 关键交互（创建 / bulk 操作 / 看板切换 / Modal）visual diff vs 上一版。

## 已知陷阱

- **CSS modules 类名是 hashed**：浏览器 inspect 看到 `_toolbarTitle_1wok9_22`，devtools 里 CSS modules 列里看原始名。
- **`color-mix` 不在 Safari < 16.4**：迁过来后保留 `color-mix(in oklab, ...)` 用法，与既有代码一致（用户已有兼容性约定）。
- **Pre-existing 类名冲突**：CSS modules 自动 scope，但全局 utility 类（`.mono` / `.btn`）不要在 module 里重定义，照旧用全局 className。

## 试点参考

完整对照：
- 前：v0.10.10 [`BatchesSection.tsx`](https://github.com/.../blob/v0.10.10/apps/web/src/pages/Projects/sections/BatchesSection.tsx)（17 处 inline）
- 后：v0.10.11 [`BatchesSection.tsx`](../../../apps/web/src/pages/Projects/sections/BatchesSection.tsx) + [`BatchesSection.module.css`](../../../apps/web/src/pages/Projects/sections/BatchesSection.module.css)（1 处 CSS variable）
- 续推：v0.10.12 `pages/Projects/sections/*.tsx` 同名 CSS modules（0 处 inline，guard 已收口为 glob）
