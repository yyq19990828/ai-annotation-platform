# 故障排查 / 踩坑手册

收录从 v0.8 起在实际开发与 CI 中踩到的"非显然 BUG"，以**症状 → 根因 → 修复**的方式归档，便于快速对症。每篇都标注关联 commit / ADR，可顺藤往代码层挖。

> 写作约定：当你修了一个非显然的问题，新增本目录文件，比改 commit message 更值得。CLAUDE.md §5 在 PR 模板里勾选「引入新踩坑」即落到这里。

## 速查表

| 症状 | 看哪篇 |
|---|---|
| 改了 Celery task 代码不生效 / `TypeError` 出现新参数找不到 | [Docker rebuild vs restart](./docker-rebuild-vs-restart) |
| ML Backend 注册时报 URL 不可达 / `localhost` 被拒 | [容器网络与 loopback 限制](./container-networking) |
| AI 预标注完成但前端工作台看不到候选框 | [Prediction Schema 适配器陷阱](./schema-adapter-pitfalls) |
| 跑完 `pnpm test:e2e` 后开发数据被清空 | [Dev 数据保护：DELETE vs TRUNCATE](./dev-data-preservation) |
| `useState(...)` 报 `Cannot access 'X' before initialization` | [React useState TDZ 陷阱](./react-tdz-trap) |
| 容器内 `parents[3]` 越界 / `.env` 路径报错 | [环境变量与 config 路径](./env-and-config-paths) |
| GitHub Actions `services:` 启动 MinIO 失败 / FastAPI lifespan 卡死 | [CI 服务依赖踩坑](./ci-flaky-services) |

## 写一篇新踩坑文档

```markdown
# <一句话标题，尽量复用症状关键词>

## 症状
<复现路径或日志片段>

## 复现
<最小复现步骤；能挂个测试就挂>

## 根因
<指向具体代码 / 库行为 / 平台限制>

## 修复 / 规避
<给出补丁或工作流变更，附验证命令>

## 相关
- commit: `<hash>` <subject>
- ADR: <若有>
- 代码：`path/to/file.py:line`
```
