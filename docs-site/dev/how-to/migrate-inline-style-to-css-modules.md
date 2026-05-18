# 把页面级 inline style 迁到 CSS modules

::: tip Since v0.10.11
首个试点：`apps/web/src/pages/Projects/sections/BatchesSection.tsx`（17 处 inline → CSS modules）。v0.10.12 已清空 `pages/Projects/sections/*.tsx` inline style，并把 lint guard 收口为 glob。本文以它们为蓝本，后续页面群复刻同样步骤。
:::

## 为什么要迁

[ROADMAP §B CSP `style-src` nonce 收紧](https://github.com/anthropics/...#) 的前置依赖：全站 ~2900 处 `style={{...}}` 重构。只有把这些迁完才能从 CSP 头里摘掉 `'unsafe-inline'`，把浏览器允许的内联样式收窄到只接受 nonce 标注的（与 v0.9.11 收紧 script-src 同模式）。

每次迁一个 section 即可，不需要 big-bang。

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
- **Button 覆盖类**：因为 [`Button`](../../../apps/web/src/components/ui/Button.tsx) 自身用 inline `style` 设 base，外部 CSS 类必须 `!important` 才能覆盖。给这些类加注释说明「桥接 Button inline style」，等 Button 自身重构后摘掉。
- **真正一次性动态值**：用 CSS custom property，TSX 端 `style={{ ["--var-name" as never]: dynamicValue }}` + `// eslint-disable-next-line no-restricted-syntax`。

### 3. 在 TSX 里 `import styles from "./X.module.css"` 并把 `style={{...}}` 替换成 `className={styles.xxx}`

简单工具函数避免引第三方依赖：

```tsx
function cn(...xs: Array<string | false | null | undefined>): string {
  return xs.filter(Boolean).join(" ");
}
```

### 4. 加 ESLint 文件级 guard

在 [`apps/web/eslint.config.js`](../../../apps/web/eslint.config.js) 末尾把当前文件加进 override：

```js
{
  files: ["src/pages/Projects/sections/<NewSection>.tsx"],
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

`pages/Projects/sections/` 已收口为 glob；后续页面群同样在清零后把 `files` 列表合并为对应 glob。

### 5. 验证

- `pnpm --filter web typecheck` 干净。
- `pnpm --filter web lint <file>` 干净（lint guard 不报）。
- `pnpm --filter web vitest run` 该 section 既有测试全过（无视觉回归）。
- `grep -c "style={{" <file>.tsx` 应为 0 或 1（CSS custom property 例外，必须有 `eslint-disable-next-line` 注释）。
- preview 实际渲染：进入该 section 关键交互（创建 / bulk 操作 / 看板切换 / Modal）visual diff vs 上一版。

## 已知陷阱

- **Button 组件外部 className 覆盖必须 `!important`**：Button 用 inline style 设 base，CSS 类规则被 inline style 覆盖。临时桥，等 Button 自身重构后摘掉。
- **CSS modules 类名是 hashed**：浏览器 inspect 看到 `_toolbarTitle_1wok9_22`，devtools 里 CSS modules 列里看原始名。
- **`color-mix` 不在 Safari < 16.4**：迁过来后保留 `color-mix(in oklab, ...)` 用法，与既有代码一致（用户已有兼容性约定）。
- **Pre-existing 类名冲突**：CSS modules 自动 scope，但全局 utility 类（`.mono` / `.btn`）不要在 module 里重定义，照旧用全局 className。

## 试点参考

完整对照：
- 前：v0.10.10 [`BatchesSection.tsx`](https://github.com/.../blob/v0.10.10/apps/web/src/pages/Projects/sections/BatchesSection.tsx)（17 处 inline）
- 后：v0.10.11 [`BatchesSection.tsx`](../../../apps/web/src/pages/Projects/sections/BatchesSection.tsx) + [`BatchesSection.module.css`](../../../apps/web/src/pages/Projects/sections/BatchesSection.module.css)（1 处 CSS variable）
- 续推：v0.10.12 `pages/Projects/sections/*.tsx` 同名 CSS modules（0 处 inline，guard 已收口为 glob）
