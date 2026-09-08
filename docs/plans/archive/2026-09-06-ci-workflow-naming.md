# CI 命名标准化

## Context

`.github/workflows/` 共 10 个 workflow,顶层 `name` 三种大小写风格混用(Title Case / sentence case / 动词开头),`docs.yml` 实际是 GitHub Pages 部署却占了最泛的文件名,job 显示层也不一致(ci.yml 全有语义 job name,visual-regression 的 job name 与 workflow name 冗余重复)。

本 PR 定一套命名规范并一次性对齐,再加 advisory 守护防止漂移。用户已确认三个决策:

1. 顶层 name 统一 **sentence case**(专有名词/缩写保留:Claude、CI、PR、Playwright)
2. 文件名仅改 `docs.yml` → `docs-deploy.yml`,其余不动
3. 新增 advisory 检查脚本 `scripts/check-workflow-names.mjs`(挂 CI lint job + pre-commit)

约束(已核实):main 无分支保护,check 名变化零风险;仓库内无 `gh workflow run` 脚本引用;DEV.md / docs-site / scripts / CHANGELOG 无 workflow 名引用;引用仅 README badge ×2 与两个 workflow 的 paths 自引用。

## 命名规范(定案)

- **文件名**:`<domain>-<action>.yml`,kebab-case;跨域聚合用 `ci.yml`
- **顶层 name**:sentence case,`<Domain> <action>`;专有名词与缩写保留原样(Claude、CI、PR、Playwright、VitePress、SDK、E2E)
- **job**:聚合 workflow(ci.yml)每个 job 设 `name: <Domain> <tool/action>`;单域 workflow 不设 job name(靠 job id,避免 GitHub 显示 "X / X" 冗余)
- **step**:动词开头(现状已基本符合,不改)

## 改动清单

### A. 顶层 name 对齐 sentence case(4 个文件)

| 文件                       | 现值                 | 新值                 |
| -------------------------- | -------------------- | -------------------- |
| `auto-draft-pr.yml:1`      | `Auto Draft PR`      | `Auto draft PR`      |
| `claude-code-review.yml:1` | `Claude Code Review` | `Claude Code review` |
| `claude-docs-impact.yml:1` | `Claude Docs Impact` | `Claude docs impact` |
| `visual-regression.yml:1`  | `Visual Regression`  | `Visual regression`  |

保留不动(已合规):`CI`、`Claude Code`(产品名)、`Docs validate`、`Docs impact check`、`Docs media audit`。

### B. `docs.yml` → `docs-deploy.yml`

1. `git mv .github/workflows/docs.yml .github/workflows/docs-deploy.yml`
2. 顶层 name:`Deploy docs site` → `Docs deploy`
3. 同步文件内 paths 自引用:`.github/workflows/docs.yml` → `.github/workflows/docs-deploy.yml`(原 docs.yml:14)
4. `README.md:10` badge URL:`actions/workflows/docs.yml` → `actions/workflows/docs-deploy.yml`(alt 文本 `Docs` 保留;`ci.yml` badge 不动)

### C. 删 visual-regression.yml 的冗余 job name

删 `visual-regression.yml:24` 的 `name: Playwright Visual Regression`,显示从 "Visual Regression / Playwright Visual Regression" 变为 "Visual regression / regression"。ci.yml 的 7 个 job name 已统一为"域+工具"风格,全部保留。

### D. 新增 `scripts/check-workflow-names.mjs`(advisory)

模式参考 `scripts/check-doc-version-prefix.mjs`(advisory、`::warning::`、exit 0、支持 `--strict` 阻断):

- 扫描 `.github/workflows/*.yml`:
  1. 顶层 `name:` 存在;
  2. name 符合 sentence case:首词首字母大写,其余词小写,除非命中白名单——全大写缩写(`CI` `PR` `SDK` `E2E` `API`)+ 专有名词(`Claude` `Code` `Playwright` `VitePress` `MinIO`);白名单以常量置顶并注释可扩展;
  3. 文件名匹配 `^[a-z0-9]+(-[a-z0-9]+)*\.yml$`。
- 顶层 name 用行级正则 `^name:` 提取(无缩进首个匹配),不引 yaml 依赖。

### E. 挂载 advisory

1. `ci.yml` lint job 末尾加一步:
   ```yaml
   - name: Workflow naming (advisory)
     run: node scripts/check-workflow-names.mjs
   ```
2. `.pre-commit-config.yaml` local repo 加 hook(仿 `doc-version-prefix`:`verbose: true`、永远 exit 0):
   ```yaml
   - id: workflow-names
     name: Check workflow naming (advisory)
     entry: node scripts/check-workflow-names.mjs
     language: system
     files: ^\.github/workflows/.*\.yml$
     pass_filenames: false
     verbose: true
   ```

### F. 规范落档 + CHANGELOG

- `CLAUDE.md` 加一小节 "CI workflow naming"(英文,约 6 行,写上述规范)。
- CHANGELOG 跳过条目:纯 CI 内部工程,无用户可见影响(符合 CLAUDE.md 的跳过规则)。

## 不做的事

- `docs/plans/archive/`、`docs/changelogs/` 中旧文件名引用不追改(历史记录)
- job id、step name、三个 claude-\* workflow 的内部结构不动
- 不给 workflow name 加 emoji

## 验证

1. `node scripts/check-workflow-names.mjs` 与 `node scripts/check-workflow-names.mjs --strict` 均零 warning(改动后全部合规)
2. `pnpm exec prettier --check` 覆盖改动的 yml/md 文件
3. `git diff --check` + 全量 diff 复查(确认无意外改动)
4. push 后注意:CI auto-fix 机器人回推提交可能使 workflow 卡 `action_required`,用 check-runs API 监听、`gh run rerun` 解开
5. 合并后:Actions 页面确认 "Docs deploy" 等新名生效;README badge 指向新文件,首个 run 后恢复正常显示

## Outcome

2026-09-06 已实施全部条目（commit 于分支 `feat/规范化CI-命名`）：4 个 workflow 顶层 name 对齐 sentence case、`docs.yml` 改名 `docs-deploy.yml`（含 paths 自引用与 README badge 同步）、visual-regression 冗余 job name 移除、`scripts/check-workflow-names.mjs` 落地并挂 CI lint job 与 pre-commit、规范记入 `CLAUDE.md` "CI workflow naming" 小节。

验证结果：

- `node scripts/check-workflow-names.mjs --strict` 全绿；负向样例（Title Case / 首词小写 / 缺 name / 文件名非 kebab-case）全部命中，advisory exit 0、strict exit 1。
- 改动文件 prettier 全部通过；pre-commit 全 hook 实跑通过（新 `workflow-names` hook 验证生效）。
- CHANGELOG 按规范跳过：纯 CI 内部工程，无用户可见影响。

未尽事项：合并后需在 Actions 页面确认 "Docs deploy" 等新名生效；README badge 指向新文件，首个 run 后恢复状态显示。
