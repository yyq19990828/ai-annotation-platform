# ai-annotation-sdk

AI 标注平台官方 Python SDK(beta)。同步 Client 覆盖 projects / datasets / tasks / annotations /
predictions / jobs / exports / ml_backends / batches / members / dashboard / api_keys 等稳定自动化工作流；
并提供全局 ML registry 与 service pool 运维；extras 提供 `aap` CLI 与终端监控面板。

SDK、CLI 与 TUI 使用独立于 AAP 的 SemVer。AAP target 表示该 SDK release 完成测试与 OpenAPI 对账的
平台基线，不代表未经验证的完整兼容范围：

```python
from ai_annotation import __aap_target_version__, __version__

print(__version__)
print(__aap_target_version__)
```

```bash
aap --version  # aap <sdk-version>@AAP<aap-target-version>
```

## 安装

```bash
pip install ai-annotation-sdk            # 核心 (httpx + pydantic)
pip install 'ai-annotation-sdk[cli]'     # + aap 命令行 (typer + rich)
pip install 'ai-annotation-sdk[tui]'     # + aap tui 终端面板 (textual, 隐含 cli)
```

TUI 支持 Textual 8.x，启动时只加载 Projects、Jobs 与当前主体；Datasets、ML、看板和绩效按首次访问加载。
列表提供筛选与分页，详情可查看 Dataset items、Batch、项目 Pool，并可确认后重试 failed Job。

## 快速上手

```python
from ai_annotation import Client

# base_url / api_key 也可走环境变量 AAP_BASE_URL / AAP_API_KEY
# 或 ~/.config/ai-annotation/config.toml (显式参数优先)
with Client(base_url="http://localhost:8000", api_key="ak_...") as client:
    # 建项目 + 数据集并关联
    project = client.projects.create(name="demo", data_type="image")
    dataset = client.datasets.create(name="demo-ds", data_type="image")
    client.datasets.upload_files(dataset.id, ["./imgs/a.jpg", "./imgs/b.jpg"])
    client.datasets.link_project(dataset.id, project.id)

    # 资源维护: 只发送显式给出的字段
    client.projects.update(project.id, name="demo-renamed")
    client.datasets.update(dataset.id, description="training images")
    batch = client.batches.create(project.id, "round-1", dataset_id=dataset.id)

    # 领任务并写标注
    task = client.tasks.next(project.id)
    client.annotations.create(
        task.id, "bbox",
        geometry={"type": "bbox", "x": 10, "y": 10, "width": 100, "height": 50},
        class_name="car",
    )

    # 导入外部预测
    client.predictions.import_file(project.id, "preds.json", format="aap_json")

    # 异步导出: 创建 → 等待 → 下载
    job_id = client.exports.create(project.id, targets=["coco"])
    job = client.exports.wait(job_id, timeout=600)
    client.exports.download(job, "./export.zip")
```

错误统一抛 `ai_annotation.errors` 下的异常(`AuthenticationError` / `NotFoundError` / `JobFailedError` 等);响应模型 `extra="allow"`,容忍服务端新增字段。

## CLI

需要 `[cli]` extras。首次使用先登录(验证连通后写入 `~/.config/ai-annotation/config.toml`,权限 0600):

```bash
aap login --url http://localhost:8000 --api-key ak_...   # 省略 --api-key 则隐藏输入

aap projects list                                  # rich 表格;加 --json 输出裸 JSON
aap projects create --name demo --type image       # image|video|lidar
aap projects update <project-id> --name demo-v2

aap datasets create --name demo-ds
aap datasets upload <dataset-id> ./imgs            # 目录/单文件逐个上传(进度条)
aap datasets upload <dataset-id> ./data.zip --zip  # ZIP 整包上传
aap datasets link <dataset-id> <project-id>        # 异步建任务时自动等待 job
aap datasets preview-unlink <dataset-id> <project-id>
aap datasets unlink <dataset-id> <project-id> --yes

aap batches create <project-id> --name round-1 --dataset-id <dataset-id>
aap members add <project-id> --user-id <user-id> --role annotator

aap predictions import <project-id> result.json --format aap_json [--dry-run]
aap jobs wait <job-id>                             # 进度条跟随到终态
aap export project <project-id> --target aap_json --out out.zip

aap ml-backends list --project <project-id>        # 列本项目已启用的 ML Backend + 健康状态
aap ml-backends get <backend-id> --project <project-id>
aap ml-backends available --project <project-id>   # 列全局 backend 及本项目启用态

aap ml-registry list                               # super-admin: 物理 backend registry
aap service-pools list                             # super-admin: 逻辑 service pool
aap service-pools topology --json                  # 路由拓扑的机器可读快照

aap tui        # 按需加载的终端监控与轻运维台；需要 [tui] extras
```

所有命令支持 `--json`:输出裸 JSON、无 rich 装饰/进度条,退出码非 0 表示失败,供 CI/脚本使用。破坏性命令的 JSON 模式必须显式传 `--yes`；本地确认不会绕过服务端权限。错误统一一行 stderr 提示(401 时提示先 `aap login`)。

`ml-backends list` 只返回本项目已启用的 backend；`MLBackend.id` 是全局物理 registry ID，同一实例
在不同项目中保持同一 ID。service pool 是独立的逻辑路由身份，使用 `service-pools` 命令管理，不与
registry ID 混用。删除、卸载、drain 和能力漂移接受等保护操作需要显式确认，且不会绕过服务端的
409/503 静默守卫。

## 测试

```bash
pip install -e '.[test]'
pytest
```

其中 `tests/test_openapi_contract.py` 会从 `client.py` 的真实 HTTP 调用点提取 method/path，与
`apps/api/openapi.snapshot.json` 对账，并检查 `api-coverage.toml` 中 SDK 关注领域的端点分类
(仅 monorepo 内生效)。

## 更多文档

参见仓库文档站 `docs-site/dev/sdk/`。
