# 0015 — ML Backend URL 验证：拒绝 loopback

- **Status:** Accepted
- **Date:** 2026-05-08（v0.9.8）
- **Deciders:** core team
- **Supersedes:** —

## Context

ML Backend 注册时填 `http://localhost:9090` 或 `http://127.0.0.1:9090` 在容器化部署里**必然失败**——容器内的 `localhost` 指向容器自身，不是宿主机。但旧版本不校验，导致：

- 注册时一切正常（Pydantic 通过、DB 写入成功）
- 真正调用时 worker 报 `Connection refused`
- 错误发生在异步 task 执行期，前端只能看到"任务卡住/失败"，难以归因

是个典型的"早期失败 vs 晚期失败"取舍：晚期失败让用户在错误的层面排查（看 Celery 日志而不是看注册时的 422）。

## Decision

在 `MLBackendCreate.url` / `MLBackendUpdate.url` 加 Pydantic `field_validator`，**注册时**就拒绝以下 host：

- `localhost`
- `127.0.0.1` / `127.x.x.x` 整个回环段
- `0.0.0.0`
- `::1`（IPv6 loopback）

错误消息明确给出替代方案：

```
URL must not point to loopback. Use the Docker bridge IP (172.17.0.1)
or service DNS (e.g. grounded-sam2-backend) instead.
```

## Consequences

正向：

- 错误发生在用户填表的瞬间，归因清晰
- 文档与错误消息一致，新人不需要看代码也能改正
- 11 单测覆盖各回环变体

负向：

- 极少数同机部署 + `network_mode: host` 的场景被误伤（绕过：写宿主机真实 IP，或环境变量豁免——目前未加豁免开关，需要时再说）
- 改 IP 不改业务，没法靠 schema validator 防住"IP 写对了但服务没起来"——配套有 health check，但不强制阻拦注册（目前是 best-effort）

## Alternatives Considered

**仅在 worker 调用时检测**：放弃，原因即上文"晚期失败"。

**前端 JS 校验**：放弃，需服务端做 source of truth，前端可绕过。

## Notes

- 代码：`apps/api/app/schemas/ml_backend.py`
- 测试：`apps/api/tests/test_ml_backend_url_validator.py`（11 case）
- 相关文档：[容器网络与 loopback 限制](../../docs-site/dev/troubleshooting/container-networking.md)
- 关联 commit：`d41236b` feat(v0.9.8)
