# 0042 — 前端样式体系迁移到 Tailwind v4 + shadcn/ui

- **Status:** Accepted（v0.17.x Epic 分阶段落地，2026-06-19 起）
- **Date:** 2026-06-20
- **Deciders:** core team
- **Supersedes:** —（修订 ADR-0004 画布层的 token 来源，不推翻其 Konva 选型）

## Context

`apps/web` 自上线起自维护一套视觉体系：约 155 个 CSS Modules（`*.module.css`）+ 手写 `tokens.css`（`--color-*` 变量）+ 每处状态色手工配 light/dark。随页面与组件增长，这套自维护体系的税越来越重：

1. **暗色模式反复破**：每个状态文字 / 软底都要人工写 light/dark 配对，漏一处就在暗色下穿帮（本仓历史多次暗色回归的根因）。
2. **token 命名分散**：中性面 / 文字 / 边框 / 状态色散落在 `tokens.css` 与各 module.css，无单一事实源。
3. **交互原语全手写**：Dialog / Dropdown / Tooltip / Select 的键盘、焦点陷阱、a11y 都自己实现且不齐，维护成本高、可达性参差。
4. **新组件起步重**：每加一个组件先写一份 module.css，样式与结构两处来回。

业界 shadcn/ui（Radix primitives + Tailwind）已是成熟范式：无障碍交互来自 Radix，样式用 Tailwind utility，主题用 CSS 变量单点驱动 —— 正对上面四条痛点。

| 方向 | 主要卖点 | 主要劣势 |
|---|---|---|
| **迁到 Tailwind v4 + shadcn/ui** | 单 token 源、暗色单点驱动、a11y 原语现成、门禁可机械守护 | 一次性大改面、引入新依赖、团队需适应 utility 风格 |
| 保持 CSS Modules + tokens.css | 不动现状、零迁移成本 | 暗色双份维护、命名分散、原语手写的税永久存在 |
| 只引 Tailwind 不引 shadcn | 拿到 utility + 暗色变量 | 仍要手写全部交互原语的 a11y，省不掉最重的一块 |

## Decision

**把 `apps/web` 的样式体系全量迁到 Tailwind v4 + shadcn/ui，退役自维护的 CSS Modules + `tokens.css`。**

- **单一 token 源**：`apps/web/src/styles/shadcn.css` 用 `--sc-*` 收敛中性面 / 文字 / 边框 / radius / focus ring / 画布专属值；Tailwind 语义类（`bg-card` / `text-foreground` / `border-border` …）在 `@theme inline` 映射到运行期 `--sc-*`。
- **暗色单点驱动**：`data-theme="dark"` 重定向 Tailwind `dark:` variant，删除散落的手工 light/dark 配对。
- **交互原语委托 Radix**：`components/shadcn/ui/` 落地 25 个原语（`dialog` / `dropdown-menu` / `tooltip` / `select` / `popover` …，纯 `radix-ui`）；`Modal → Dialog`、`Toast → sonner`、`Icon → lucide-react`，旧 `components/ui/*` 收敛为薄适配层后删除。
- **红线「只换皮、行为零回退」**：业务逻辑 / 数据流 / 路由 / 画布渲染逻辑均不动，逐阶段以 light/dark 双主题截图基线把关。分阶段串行（0.17.0 地基 → 0.17.7 收官，第二阶段 0.17.8–0.17.11 收敛状态色 / 字号 / z-index / spacing）。
- **CI 门禁兜底**：`apps/web/scripts/check-tw-tokens.mjs` 禁裸色 / 任意色值、强制暗色 token 化，0.17.0 以 warning 观测、0.17.7 转 blocking 并入 `pnpm lint`，锁死「不回潮」。
- **画布层例外**：10 个 Konva 画布叠加层（像素定位 / z-index 编排）保留 `*.module.css`，但内部 `var(--color-*)` 改指 `var(--sc-*)`、登记门禁白名单 —— **修订 [ADR-0004](0004-canvas-stack-konva.md) 画布层的 token 来源，不动其 Konva 选型与渲染逻辑**。

## Consequences

正向：

- **单一 token 源 + 暗色单点驱动**：状态色 / 中性面在 `shadcn.css` 一处定义，`data-theme` 切换，告别逐处手工配对。
- **净删约 1.3 万行 CSS**：epic 收口时全仓 `module.css` 从 ~155 降到 60（10 个 Konva 画布白名单 + 50 个未纳入本 epic 的页面 / 组件），`tokens.css` 整体删除。
- **a11y 来自 Radix**：键盘 / 焦点 / ARIA 由 Radix 统一保证，不再各组件手写。
- **门禁防回潮**：`check-tw-tokens.mjs` 硬阻断新增裸色 / 任意色，设计系统约束机械可守。

负向（已知，接受）：

- **新增依赖**：Tailwind v4 + `@tailwindcss/vite`、`radix-ui`、`sonner`、`lucide-react`、`clsx` / `tailwind-merge`（`cn`）。
- **vendored 原语未补单测**：`components/shadcn/ui/` 的 25 个原语是 vendored 拷贝，本 epic 未为其补组件测试，提交时 patch 覆盖率显著下降（codecov 报告所示）—— 属换皮范围外、按 shadcn 惯例接受，真实交互回归由各消费页面测试 + Playwright 截图基线守护。
- **一次性大改面**：502 文件、92 提交，review 面广；以分阶段 + 双主题截图基线 + 「行为零回退」红线控制风险。
- **团队需适应 utility 风格**：className 取代 module.css，初期心智切换成本。

## Alternatives Considered（详）

**保持 CSS Modules + tokens.css**：零迁移成本，但暗色双份维护、token 命名分散、交互原语手写的税永久存在，且每加一个组件 / 状态色都要重复一遍。上线前不收口，组件只会更多、迁移成本只增不减。否决。

**只引 Tailwind、不引 shadcn**：能拿到 utility 与暗色变量，但 Dialog / Dropdown / Tooltip 等的键盘 / 焦点 / a11y 仍要全部手写 —— 正是最重、最易出错的一块，省不掉。否决。

**换重组件库（MUI / Ant Design）**：运行时重、定制需对抗其默认主题、与既有 Geist 设计基调冲突，且仍要把现有 CSS Modules 全量重写。性价比不如 shadcn（源码进仓、可改、零运行时锁定）。否决。

## Notes

- 实现位置：
  - 单 token 源：`apps/web/src/styles/shadcn.css`
  - shadcn 原语：`apps/web/src/components/shadcn/ui/`（25 个）
  - 门禁：`apps/web/scripts/check-tw-tokens.mjs`（`pnpm lint` / `pnpm lint:css-tokens`）
  - 配置：`apps/web/components.json`、`apps/web/src/lib/utils.ts`（`cn`）
- 设计规范：`docs-site/dev/reference/design-system.md`
- Epic 计划：`docs/plans/2026-06-19-v0.17.x-ui-shadcn-migration-epic.md`、`docs/plans/2026-06-20-v0.17.x-design-system-phase2-epic.md`
- 相关 ADR：[ADR-0004](0004-canvas-stack-konva.md)（Konva 画布栈，本 ADR 仅改其画布层 token 来源）、[ADR-0040](0040-shared-annotation-visual-spec-not-stack-merge.md)（标注视觉规格，画布渲染参数不受本次换皮影响）
