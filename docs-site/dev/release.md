# 发布流程

## 版本号

[Semantic Versioning](https://semver.org/lang/zh-CN/) `MAJOR.MINOR.PATCH`：

- **MAJOR** — 破坏性 API 变更
- **MINOR** — 新功能（向后兼容）
- **PATCH** — 修 bug

前端 `apps/web/package.json` 与 `CHANGELOG.md` 的版本号同步。

## 流程

1. 在 `main` 分支上：
   ```bash
   git pull
   pnpm install
   pnpm test
   cd apps/api && uv run pytest
   ```
2. 更新 `apps/web/package.json` 的 `version`
3. 在 `CHANGELOG.md` 顶部新增版本段落，描述：
   - **新增**：feat 列表
   - **修复**：fix 列表
   - **变更**：refactor / breaking
   - **测试**：新增或调整的测试
4. 提 PR，merge 后打 tag：
   ```bash
   git tag v0.x.y
   git push origin v0.x.y
   ```
5. （可选）GitHub Release 复用 CHANGELOG 当次段落

## CHANGELOG 风格

参考现有条目（`/CHANGELOG.md`）：每个版本写明动机、关键文件、测试要点。**不要**只写一行「升级 v0.x.y」。

## 数据库迁移

任何会动 schema 的版本，CHANGELOG 必须包含「迁移」小节，说明 alembic 版本号与回滚策略。

## 文档同步

发布前确认：

- [ ] CHANGELOG 顶部最新版本段落
- [ ] `apps/api/openapi.snapshot.json` 与代码一致（`pnpm openapi:check`）
- [ ] `docs-site/` 中受影响的页面已更新
- [ ] ADR：如有架构决策，新增 `docs/adr/0XXX-*.md`
