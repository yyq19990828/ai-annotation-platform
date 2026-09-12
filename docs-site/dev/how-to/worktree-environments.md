---
audience: [dev]
type: how-to
status: stable
last_reviewed: 2026-09-12
---

# 独立工作树开发环境

`pnpm dev:worktree` 为当前 checkout 管理独立的开发状态，不再只隔离 HTTP 端口。它保留 Alembic，不会把共享数据库降级、重新 stamp，或复制主目录的业务数据。

## 前置条件

- macOS 或 Linux、Node.js、pnpm，以及当前 checkout 独立的 `apps/api/.venv`。先完成 [Orca 工作树初始化](../tutorials/local-dev#orca-工作树初始化)。
- 本机 Docker 可用；共享 PostgreSQL、MinIO 已经启动。建议在主目录只执行 `docker compose up -d postgres minio`，不要为每个工作树重复启动默认 Compose 栈。
- PostgreSQL 配置使用本机 `postgresql+asyncpg` URL，不带 query 参数；运行连接与迁移连接必须指向同一个本机实例。两个账号都需要连接 `postgres` 库，启动器通过会话锁核对实例，不能仅凭 loopback 地址和相同端口判断。迁移账号需要创建数据库及管理新库的权限。MinIO endpoint 也必须位于本机，账号需要创建、标记和管理专属 bucket 的权限。
- 默认工作树模式关闭外发 SMTP、Sentry、共享 ML 后端自动注册和 GPU 控制配置，不会启动 GPU worker 或 beat。真实 GPU 调度验证应使用专用验收环境，不能让多个独立控制面管理同一块卡。

这不是生产环境隔离或权限沙箱：基础设施进程和账号可能共享。启动器拒绝 staging/production 配置，也不会自动启动、停止或重建共享 PostgreSQL/MinIO 服务。

## 首次启动与资源归属

在工作树根目录运行：

```bash
pnpm dev:worktree
# 需要导入、导出、审计、派生媒体等后台任务时：
pnpm dev:worktree -- up --with-worker
```

首次启动会创建独立数据库、Redis 容器和七个 bucket，再运行本 checkout 的迁移。已有且归属正确的资源会复用；已有但未标记或属于别处的资源不会被自动接管。

| 资源            | 隔离方式                                                          |
| --------------- | ----------------------------------------------------------------- |
| PostgreSQL      | 共享实例，库名为 `aap_wt_<id>_<mode>`；数据库 comment 记录归属    |
| Redis           | 独立、带归属标签的容器；端口仅绑定本机，AOF 存放在工作树目录      |
| MinIO           | 共享实例，七个 bucket 分别使用环境前缀并记录归属标签              |
| API/Web         | 当前 checkout 的进程，自动分配空闲端口并设置 API/WebSocket 代理   |
| Celery          | 可选的普通及维护 worker，各自单并发，共用本环境的 Redis 和 bucket |
| DuckDB/临时文件 | 当前工作树、当前模式的独立目录                                    |

`.worktree/identity.json` 保存稳定 ID 和 checkout 路径；提交代码不会改变 ID。各模式下的资源清单和进程记录也保存在 `.worktree/`，不包含数据库密码或完整连接串。该目录已被 Git 忽略，**不要复制、软链接或随手删除它**；丢失归属记录后不能靠资源名自动接管旧数据。移动工作树前，应先停止并按需销毁旧环境。

`.env` 仍可链接主目录作为基础配置，运行时仅向子进程注入独立目标，不修改共享文件。直接运行 `pnpm dev:api`、`uv run pytest` 或默认 Compose 不经过这个隔离入口，仍按原来的配置工作。

媒体上传下载地址统一使用同源 `/minio`，Vite 转发到已验证的本机 MinIO endpoint；远程浏览器只需能访问 Web 端口。应用临时文件按模式隔离，端口预留锁则统一保存在用户目录的 `.cache/aap-dev-ports`，供所有工作树和模式协调使用。

前端进程只接收系统和公开配置，不继承数据库或对象存储凭据。API 配置通过匿名管道交给监督进程后传给 API 子进程，不写入磁盘或命令行；API/普通 worker 不继承迁移账号连接。专用维护 worker 将同库的 owner 连接作为 `DATABASE_URL`，同时清空迁移和测试连接变量。进程身份同时核对启动时间、工作树范围和命令摘要，支持软链接入口和相对路径调用。

新库只有迁移创建的结构及必要数据，没有原来的账号、项目或媒体。需要管理员时，在下面的隔离 `exec --mode dev` 中运行现有的 `scripts.bootstrap_admin` 流程；凭据按[开发部署说明](/ops/deploy/development#_2-5-首个-super-admin)配置，不放进工作树身份清单。

## 三种模式与测试命令

- `dev`：日常开发，`up/init/doctor/stop/reset/destroy` 默认使用它。
- `test`：可丢弃的 API 测试环境，`exec` 默认使用它。
- `e2e`：另一套独立的端到端测试环境。

每种模式都有独立数据库、Redis、bucket 和文件目录。同一个模式同时只允许一个管理/执行会话，避免测试重置与开发请求交错。不同工作树、或同一工作树的不同模式可以并行。

```bash
# 只准备资源和迁移，不启动 API/Web
pnpm dev:worktree -- init --mode test

# API 测试：保持测试所要求的 apps/api 工作目录
pnpm dev:worktree -- exec --mode test -- sh -c 'cd apps/api && .venv/bin/python -m pytest tests/test_alembic_drift.py'

# Playwright：统一注入测试库、存储、Redis，并预留互不冲突的服务端口
pnpm dev:worktree -- exec --mode e2e -- pnpm test:e2e

# 后台任务相关验收，可以给 exec 同时启动对应 worker
pnpm dev:worktree -- exec --mode e2e --with-worker -- pnpm test:e2e
```

`exec` 的命令从工作树根目录执行，`--` 后面的参数原样传给子进程。`TEST_DATABASE_URL` 和 `PLAYWRIGHT_E2E_DATABASE_URL` 由入口统一覆盖。入口自动注入 `AAP_WORKTREE_MODE`；在 `dev` 模式中，pytest 和 Playwright 会在准备测试数据库前明确拒绝运行，且不导出其他模式的可用测试连接。需要同类测试并行时使用不同工作树，不要绕过模式锁或手工改写这个内部标识。

Playwright 的迁移和数据库夹具使用隔离库的所有者连接；其 API 使用同库的运行账号，并在启动前清空迁移及夹具连接变量。

`--with-worker` 使用当前 checkout 的 Python 依赖，同时启动普通和维护 worker。普通 worker 消费 `default,media,cleanup,audit,export,image-pyramid,ml.cpu`；维护 worker 只消费 `maintenance`，负责审计与预测月分区、旧审计分区归档，以及人员效率和审计统计物化视图刷新。两者均需通过任务注册与队列订阅检查，`doctor` 分别显示 `worker` 和 `maintenance_worker`；任一个退出都会停止同次启动的服务。

这两类 worker 不消费 GPU 队列，也不复用主目录的 Docker worker。媒体任务需要的系统依赖仍须在本机安装。修改 worker Python 代码后应停止并重启当前环境，Celery 不会热重载。

## 诊断、停止与重建

```bash
pnpm dev:worktree -- doctor
pnpm dev:worktree -- doctor --mode test
pnpm dev:worktree -- stop --mode test
```

`doctor` 不创建资源；它返回 JSON，显示环境身份、资源归属、数据库 revision、本 checkout head、Redis 连通性、进程与 HTTP 就绪状态。未初始化、资源不齐或检查失败时返回非零退出码。启动中的服务不会被当作已就绪。输出不包含连接凭据。

`Ctrl+C` 停止本次启动的 API/Web 和可选 worker，保留资源。`stop` 还会停止对应 Redis 容器，但保留 PostgreSQL、bucket、Redis AOF 和分析文件。进行中的任务不保证能够原地恢复，重要任务应先等到完成后再停止。

需要清空当前环境时，先停止相关客户端，再从 `doctor` 的 `resources.confirmation` 复制精确确认值：

```bash
pnpm dev:worktree -- reset --mode test --confirm '<id>:test'
pnpm dev:worktree -- destroy --mode e2e --confirm '<id>:e2e'
```

- `reset`：删除该模式的数据库、Redis、bucket、派生文件，再创建空环境并迁移。
- `destroy`：只删除该模式资源，保留工作树身份；验证资源删除后清除该模式的目标记录，允许下次初始化选择新的本机基础设施。
- `--confirm` 不是泛化的 `--yes`；必须匹配当前工作树和模式。
- 有数据库连接、环境会话仍在运行、资源标记不匹配时拒绝删除。不使用强制断开数据库连接、全局删桶或共享栈 `down`。
- 基础设施地址变化时，先使用旧配置处理旧环境，不能让同一份清单静默改指另一个服务器。

销毁工作树前，分别清理已经使用过的模式。Git/Orca 删除工作树不会自动删除数据库和 bucket。

## 迁移冲突

启动前会检查重复 revision、多 head、缺失祖先及数据库未知 revision。数据库版本不在当前代码中时，恢复对应迁移代码，或在确认可丢弃后重建独立环境；不要手工修改共享 `alembic_version`。

`--skip-migrations` 只在数据库已经处于当前 checkout 的 head 时生效，不能绕过不认识的 revision。独立开发库不会自动解决 PR 合并后的迁移冲突；主分支仍应保持唯一 head，并对最终合并状态验证空库和已有数据升级路径。

## 验证启动器本身

```bash
node --test scripts/dev-worktree.test.mjs
apps/api/.venv/bin/python -m unittest discover -s scripts -p 'test_worktree*.py' -v
apps/api/.venv/bin/python scripts/test-orca-worktree-setup.py

# 真实基础设施验收：创建随机、带归属标记的临时资源并在结束时删除
apps/api/.venv/bin/python scripts/verify_worktree_isolation.py -v

# 分离账号验收：临时 PostgreSQL、专属 Redis/bucket，实际派发五项维护任务
apps/api/.venv/bin/python scripts/verify_worktree_maintenance.py
```

两条 `verify_worktree_*` 命令会创建和删除临时资源，不是无副作用的单元测试。隔离验收覆盖迁移、Redis 键与 Pub/Sub、停止恢复、对象隔离和重建；维护验收额外使用临时 PostgreSQL 容器创建分离账号，验证普通账号不能执行维护 SQL、五项维护任务成功、两个 worker 退出后无遗留连接。只在已核对的本机开发基础设施上运行。
