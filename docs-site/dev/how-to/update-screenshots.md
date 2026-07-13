---
title: 更新文档截图
description: 如何新增场景、更新现有截图、维护视觉回归基线
audience: [developer]
type: how-to
status: stable
last_reviewed: 2026-07-13
---

# 更新文档截图

本平台采用 Playwright 自动化产出文档图片，支持矩阵化截图（多视口 / 多主题）、
元素级裁切、SVG 注释叠加、网络状态 mock 以及流程录制（GIF/MP4）。

## 快速运行

```bash
# 前置：基础服务、API 和 Web 都已启动
cd apps/api
PYTHONPATH=. uv run python scripts/seed.py \
  --profile screenshots --repair --ml-backend-mode live

cd ../web

pnpm screenshots                  # desktop-light 全量（最常用）
pnpm screenshots:dark             # desktop-dark 变体
pnpm screenshots:matrix           # desktop-light / dark / mobile
pnpm screenshots:flows            # 流程录制 → GIF（需 ffmpeg）
pnpm screenshots:regression       # 视觉回归（每次 release 前跑）
pnpm screenshots:lint             # 检查文档引用图是否都在 manifest

# 开发/验证场景：执行真实导航和 locator 校验，但不写 PNG/manifest
SCREENSHOT_VALIDATE_ONLY=1 pnpm screenshots
```

截图脚本从只读 screenshot catalog 获取当次运行的 UUID，并分别使用 seed 中的
`admin`、`anno` 和 `qa` 账号呈现超管、标注员和审核员的真实项目关系。
AI 场景必须先绑定能力匹配的 ML Backend；无 GPU 时启动
`screenshot-ml-stub` 并把 seed 命令的模式改为 `stub`。

## 目录结构

```
apps/web/e2e/screenshots/
├── scenes/                    # 场景声明（按功能分文件）
│   ├── _types.ts              # ScreenshotScene 接口定义
│   ├── auth.ts
│   ├── workbench-polygon.ts
│   ├── workbench-sam.ts
│   ├── workbench-media.ts
│   ├── projects.ts
│   ├── review.ts
│   ├── export.ts
│   ├── ai-pre.ts
│   └── index.ts               # 聚合导出
├── catalog.ts                     # fixture / backend capability 预检
├── environment.ts                 # 固定时钟、禁动画、资源 ready
├── _helpers/
│   ├── annotate.ts            # SVG overlay 注释
│   ├── mock-state.ts          # page.route 网络状态 mock
│   └── recorder.ts            # video → GIF 转换
├── flows/                     # 流程录制脚本
│   ├── e2e-quickstart.ts
│   ├── ai-preannotate.ts
│   ├── review-reject.ts
│   └── flows.spec.ts
├── regression/                # 视觉回归
│   ├── regression.spec.ts
│   └── __screenshots__/       # 基线截图（提交入 git）
├── outputs/                   # 运行时产出（.gitignore 中）
│   ├── manifest.json          # 自动生成的图清单
│   └── flows/                 # GIF / WebM
└── screenshots.spec.ts        # 主 driver
```

## 新增一个截图场景

### 1. 在对应类别文件中添加 scene

```typescript
// apps/web/e2e/screenshots/scenes/projects.ts
export const PROJECT_SCENES: ScreenshotScene[] = [
  // ... 已有场景

  {
    name: "projects/my-new-scene",
    role: "admin",
    fixture: {
      project: "image_demo",
      task: "annotating",
    },
    route: (catalog) => `/projects/${catalog.projects.image_demo.id}/settings`,

    prepare: async (page, catalog) => {
      await page.getByText(catalog.projects.image_demo.name, { exact: true }).waitFor();
      // 打开目标 tab / modal / 交互
    },

    // 截图模式（不填 = viewport）
    capture: { kind: "locator", selector: '[data-testid="my-panel"]', padding: 8 },

    // 自动注释（可选）
    annotate: [
      { selector: '[data-testid="key-button"]', style: "rect-red", label: "点击这里" },
    ],

    // 数据脱敏（可选，叠加到默认 mask 之上）
    mask: ["[data-testid='sensitive-info']"],

    // 矩阵（可选，不填只跑 desktop-light）
    matrix: { themes: ["light", "dark"] },

    target: "docs-site/user-guide/images/projects/my-new-scene.png",
  },
];
```

### 2. 运行生成图片

```bash
cd apps/web
# 先只验证，不写正式资产
SCREENSHOT_VALIDATE_ONLY=1 pnpm screenshots --grep "my-new-scene"
# 通过后生成目标图
pnpm screenshots --grep "my-new-scene"
```

### 3. 在文档中引用

推荐使用 `<AutoImage>` 组件（自动显示「自动产出」badge）：

```md
<AutoImage src="projects/my-new-scene.png" alt="我的新场景" />
```

或普通 Markdown 图片：

```md
![我的新场景](../images/projects/my-new-scene.png)
```

### 4. 检查 manifest

```bash
cd apps/web
pnpm screenshots:lint
```

## `ScreenshotScene` 完整字段说明

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | `string` | 唯一标识，用于 `--grep` 过滤 |
| `role` | `Role \| Role[]` | 登录角色（admin / annotator / reviewer） |
| `fixture` | 可选对象 | 场景依赖的 catalog 项目、任务、批次、backend 和 capability |
| `route` | `(catalog: ScreenshotSeedCatalog) => string` | 用 catalog 逻辑键构造页面路由 |
| `prepare` | 可选函数 | 截图前交互（打开 modal / 切 tab 等） |
| `capture` | 可选 | 截图模式：fullPage / locator / clip |
| `annotate` | 可选数组 | 自动红框 / 编号注释 |
| `mask` | 可选 `string[]` | 额外脱敏选择器 |
| `mockState` | 可选 | 网络状态：empty / error / loading / rate-limited |
| `matrix` | 可选 | 矩阵维度：viewports / themes / locales |
| `target` | `string` | 输出 PNG 路径（相对仓库根） |

## 视觉回归基线更新

当 UI 有意改变导致 regression 失败时：

```bash
cd apps/web
# 更新基线
pnpm screenshots:regression -- --update-snapshots

# 查看 diff（在 test-results/ 目录）
# 确认无误后提交基线变更
git add e2e/screenshots/regression/__screenshots__/
git commit -m "chore(screenshots): 更新视觉回归基线 — <变更原因>"
```

## 手动维护的图

maintainer 手动修改图片时，在 `manifest.json` 里把 `auto` 改为 `false`，
下次自动运行会跳过该图不覆盖：

```json
{
  "docs-site/user-guide/images/<page>/<figure>.png": {
    "auto": false,
    "note": "示意图需人工合成，自动化无法复现"
  }
}
```

## 常见问题

**Q: seed/catalog 报项目、任务或 backend 缺失**
确认已启动 live backend 或截图协议 stub，然后重跑 `scripts/seed.py --profile screenshots
--repair --ml-backend-mode <live|stub>`。catalog 会在导航前报出具体逻辑键和缺失能力，
不会退化为任意项目。

**Q: locator 截图失败（元素找不到）**
检查 `data-testid` 是否正确，或在 `prepare` 里等待具体业务 ready selector。
locator capture 不会退化为整页图；元素缺失必须修复场景或产品问题。

**Q: 远程打开工作台一直显示「重连中」**
DEV 远程页面应连当前 `:3000` 同源的 `/ws`，由 Vite 升级并转发到 API。
不要把 Docker 默认 IP 或服务器的 `localhost:8000` 当成远程浏览器可达地址。
同理，媒体应走同源 `/minio`。详见 [WebSocket 调试](./debug-websocket.md)。

**Q: ffmpeg 不可用，GIF 无法生成**
安装 ffmpeg：`sudo apt install ffmpeg` 或 `brew install ffmpeg`，
或设置 `FFMPEG_PATH=/path/to/ffmpeg`。

**Q: 视觉回归误报（字体渲染差异）**
调高阈值：`maxDiffPixelRatio: 0.02`，或在 `regression.spec.ts` 里对该页面专门调整。
