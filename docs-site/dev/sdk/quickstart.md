---
title: Python SDK / CLI 快速上手
audience: [dev]
type: tutorial
since: v0.15.2
status: beta
last_reviewed: 2026-06-11
---

# Python SDK / CLI 快速上手

10 分钟跑通一条完整链路:创建数据集 → 上传数据 → 创建项目并关联 → 触发导出并下载。CLI 与 Python 两条路径任选其一。

> **版本与稳定性**:SDK 首版为 **beta**,版本号跟随平台 minor(当前 `0.15.2`)。公开 API 面只覆盖 8 个稳定工作流(projects / datasets / tasks / annotations / predictions / jobs / exports / api_keys),不包含 admin、dashboard 等内部 API。

## 安装

要求 Python >= 3.11。

```bash
pip install ai-annotation-sdk            # 核心:仅 httpx + pydantic
pip install 'ai-annotation-sdk[cli]'     # + aap 命令行 (typer + rich)
pip install 'ai-annotation-sdk[tui]'     # + aap tui 终端面板 (textual, 隐含 cli 依赖)
```

三层 extras 按需选装:只在脚本里调 API 装核心包即可;要用 `aap` 命令装 `[cli]`;要用 [TUI 监控面板](./tui)装 `[tui]`。

## 准备凭据

SDK / CLI 用 `Authorization: Bearer <api_key>` 认证,接受 `ak_` 开头的平台 API key 或 JWT(SDK 不区分)。API key 可在平台 Web 端创建,也可以用已有凭据通过 SDK 的 `client.api_keys.create(...)` 创建。

## 路径 A:CLI

首次使用先登录。`aap login` 会先用给定凭据调一次轻量接口验证连通,成功后写入 `~/.config/ai-annotation/config.toml`(权限 0600):

```bash
aap login --url http://localhost:8000 --api-key ak_...
# 省略 --api-key 则交互式隐藏输入
```

然后串起整条链路:

```bash
# 1. 创建数据集并上传(目录逐文件上传,带进度条;ZIP 整包加 --zip)
aap datasets create --name demo-ds
aap datasets upload <dataset-id> ./imgs

# 2. 创建项目并关联数据集(异步建任务时自动等待 job 完成)
aap projects create --name demo --type image     # image|video|lidar
aap datasets link <dataset-id> <project-id>

# 3. 触发导出 → 等待完成 → 下载,一条命令全流程
aap export project <project-id> --target aap_json --out ./export.zip
```

所有命令支持 `--json`(输出裸 JSON、退出码非 0 表示失败),供 CI / 脚本使用 —— 详见 [CLI 参考](./cli)。

## 路径 B:Python

```python
from ai_annotation import Client

# base_url / api_key 也可走环境变量 AAP_BASE_URL / AAP_API_KEY,
# 或 ~/.config/ai-annotation/config.toml(显式参数优先)
with Client(base_url="http://localhost:8000", api_key="ak_...") as client:
    # 1. 创建数据集并上传
    dataset = client.datasets.create(name="demo-ds", data_type="image")
    client.datasets.upload_files(dataset.id, ["./imgs/a.jpg", "./imgs/b.jpg"])

    # 2. 创建项目并关联数据集
    project = client.projects.create(name="demo", data_type="image")
    link = client.datasets.link_project(dataset.id, project.id)
    if link.async_job_id is not None:        # 大数据集走异步建任务
        client.jobs.wait(link.async_job_id)

    # 3. 异步导出:创建 → 等待 → 下载
    job_id = client.exports.create(project.id, targets=["aap_json"])
    job = client.exports.wait(job_id, timeout=600)
    client.exports.download(job, "./export.zip")
```

错误统一抛 `ai_annotation` 下的异常(`AuthenticationError` / `NotFoundError` / `JobFailedError` 等),响应模型 `extra="allow"` 容忍服务端新增字段 —— 详见 [Python SDK 参考](./python-client)。

## 下一步

- [Python SDK 参考](./python-client) — Client 构造、8 个资源命名空间全部方法、异常层级
- [CLI 参考](./cli) — 全部命令、`--json` 可脚本化契约
- [TUI 监控面板](./tui) — `aap tui` 三视图只读监控
- [Cookbook](./cookbook) — 可直接拷贝的完整脚本片段
