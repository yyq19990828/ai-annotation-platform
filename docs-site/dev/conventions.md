# 约定与规范

## 提交信息

采用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)：

```
<type>(<scope>): <subject>

<body>

<footer>
```

### type

| type | 含义 |
|---|---|
| `feat` | 新功能 |
| `fix` | 修 bug |
| `refactor` | 重构（功能不变） |
| `perf` | 性能优化 |
| `docs` | 文档 |
| `test` | 测试 |
| `chore` | 构建 / 依赖 |
| `ci` | CI 配置 |
| `style` | 格式（不影响行为） |

### scope（建议）

`api` / `web` / `workbench` / `dashboard` / `auth` / `db` / `docs` ...

### 示例

```
feat(workbench): 标注工作台 UI 美化 + 边栏可拖拽
fix(api): ProjectOut.batch_summary 改为 ProjectBatchSummary 显式模型
ci(vitest): 用真实 openapi.json 替代空 stub
```

## 分支与 PR

- **主分支**：`main`
- **功能分支**：`feat/<scope>/<short-description>` 或 `fix/<scope>/<bug-id>`
- PR 必须有：清晰标题（同 commit 规范）、test plan、相关 issue 链接
- PR 必须通过：pytest + vitest + lint + e2e（continue-on-error 阶段除外）+ openapi-contract

## 命名

### Python（apps/api）

- 模块、函数：`snake_case`
- 类：`PascalCase`
- 常量：`UPPER_SNAKE`
- 测试文件：`tests/test_<topic>.py`

### TypeScript（apps/web）

- 组件文件、组件名：`PascalCase` (`Button.tsx`, `ProjectList.tsx`)
- 工具函数文件：`camelCase` (`formatDate.ts`)
- 测试文件：`<name>.test.ts(x)` 或 `__tests__/<name>.test.tsx`
- 类型：`type` 优先于 `interface`，除非要 declaration merging
- 路径别名：`@/` 指 `apps/web/src/`

## 注释 / 文档字符串

- **不要**写复述代码的注释。代码自解释即可。
- **要**写：非显然的 WHY、外部约束、设计决策
- 公开 API（FastAPI 路由、导出函数）必须有 docstring，会被 OpenAPI 与 IDE 提示拾取

## 错误处理

- 后端：抛 `HTTPException` 或自定义异常，由全局 handler 统一格式化
- 前端：用 TanStack Query 的 `onError` 统一捕获；不要写 `catch (e) { console.error(e) }` 吞错误
- **绝不**为不可能发生的场景加防御代码

## Linting & Formatting

- 后端：`ruff check` + `ruff format`，配置在 `apps/api/pyproject.toml`（如未配置则用默认）
- 前端：`eslint` (flat config, `apps/web/eslint.config.js`)
- pre-commit hook 会自动跑

## 不引入的东西

- 不引入 `prettier` 单独配置（hey-api 内部用，主代码靠 IDE + ESLint）
- 不引入 changelog 工具（changesets / standard-version）；`CHANGELOG.md` 手写够用
- 不引入 monorepo 工具（nx / turborepo）；pnpm workspace 直管
