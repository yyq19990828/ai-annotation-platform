# ai-annotation-sdk

AI 标注平台官方 Python SDK(beta)。覆盖 8 个稳定工作流:projects / datasets / tasks / annotations / predictions / jobs / exports / api_keys;不包含 admin、dashboard 等内部 API。

## 安装

```bash
pip install ai-annotation-sdk            # 核心 (httpx + pydantic)
pip install 'ai-annotation-sdk[cli]'     # + aap 命令行 (typer + rich)
pip install 'ai-annotation-sdk[tui]'     # + aap tui 终端面板 (textual, 隐含 cli)
```

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

```bash
aap --version
aap tui        # 需要 [tui] extras
```

v0.15.2 为 CLI 骨架,完整命令集(login / projects / datasets / ...)在后续版本提供。

## 测试

```bash
pip install -e '.[test]'
pytest
```

其中 `tests/test_openapi_contract.py` 会把 SDK 使用的端点清单与 `apps/api/openapi.snapshot.json` 对账(仅 monorepo 内生效),防止 API 漂移。

## 更多文档

参见仓库文档站 `docs-site/dev/sdk/`。
