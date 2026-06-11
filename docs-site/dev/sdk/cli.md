---
title: aap CLI 参考
audience: [dev]
type: reference
since: v0.15.2
status: beta
last_reviewed: 2026-06-11
---

# aap CLI 参考

`aap` 是 Python SDK 附带的命令行工具,需要 `[cli]` extras:

```bash
pip install 'ai-annotation-sdk[cli]'
aap --version        # 输出 SDK 版本号
```

## 配置

CLI 凭据按以下优先级解析:

1. 环境变量 `AAP_BASE_URL` / `AAP_API_KEY`
2. 配置文件 `~/.config/ai-annotation/config.toml`(由 `aap login` 写入,权限 **0600**,含敏感 api_key,请勿提交到版本库)

两处都没有时,命令提示先 `aap login` 并以退出码 1 结束。

## 命令一览

### aap login

```text
aap login --url <平台地址> [--api-key <key>] [--json]
```

验证凭据并写入 `~/.config/ai-annotation/config.toml`。省略 `--api-key` 时交互式隐藏输入。写盘前会先用给定凭据调一次轻量 GET 验证连通,**验证失败不落盘**。

```bash
aap login --url http://localhost:8000 --api-key ak_...
```

### aap projects

```text
aap projects list [--json]
aap projects create --name <名称> --type <image|video|lidar> [--json]
```

```bash
aap projects list                              # rich 表格: ID/名称/类型/状态/任务进度
aap projects create --name demo --type image
```

### aap datasets

```text
aap datasets create --name <名称> [--data-type <类型>] [--json]
aap datasets upload <dataset-id> <路径> [--zip] [--json]
aap datasets link <dataset-id> <project-id> [--json]
```

- `upload`:路径为目录时递归收集全部文件逐个上传(三步流,带进度条);为单文件时只传该文件;加 `--zip` 则按 ZIP 整包上传、后端解压入库(此时路径必须是 ZIP 文件)。
- `link`:关联数据集到项目;后端异步建任务时自动跟随 job 进度直到完成。

```bash
aap datasets create --name demo-ds
aap datasets upload 0199aa... ./imgs
aap datasets upload 0199aa... ./data.zip --zip
aap datasets link 0199aa... 0199bb...
```

### aap predictions

```text
aap predictions import <project-id> <文件> [--format <aap_json|coco|yolo>] [--dry-run] [--json]
```

导入外部预测结果。`--dry-run` 只校验不落库,适合正式导入前先验文件。

```bash
aap predictions import 0199bb... preds.json --format aap_json --dry-run
aap predictions import 0199bb... preds.json --format aap_json
```

### aap jobs

```text
aap jobs wait <job-id> [--json]
aap jobs cancel <job-id> [--json]
```

- `wait`:轮询异步任务直到终态,rich 进度条跟随 `progress_pct`。job 以 failed / cancelled 结束时输出错误并以退出码 1 结束。
- `cancel`:请求**软取消**一个 job(协作式——后端写取消标记,worker 在下一条任务边界落 `cancelled`)。仅可取消的 kind 且处于 pending/running 时有效,否则后端返回 400/409、命令以退出码 1 结束。终态由后续 `jobs wait` / `tui` 反映。

```bash
aap jobs wait 0199cc...
aap jobs cancel 0199cc...
```

### aap ml-backends

```text
aap ml-backends list --project <project-id> [--json]
aap ml-backends get <backend-id> --project <project-id> [--json]
```

只读查看某项目挂载的 ML Backend 及健康状态。`list` 输出 rich 表格(名称 / 状态 / model_version / GPU 利用率 / url),`state` 为 `connected` / `error`;`get` 输出含 `health_meta`(GPU / cache / capabilities)的完整对象。

```bash
aap ml-backends list --project 0199bb...
aap ml-backends get 0199dd... --project 0199bb... --json
```

### aap export

```text
aap export project <project-id> --target <格式> --out <输出路径> [--json]
```

一条命令完成「创建导出 job → 等待完成 → 下载到 `--out`」全流程。`--target` 为导出格式,如 `aap_json` / `coco`(完整清单见[导出格式参考](/user-guide/reference/export-formats))。

```bash
aap export project 0199bb... --target aap_json --out ./export.zip
```

### aap tui

```text
aap tui
```

启动 [TUI 监控面板](./tui),需要 `[tui]` extras;未安装时提示安装命令并以退出码 1 结束。

## --json 可脚本化契约

所有业务命令支持 `--json`。**CI / 脚本只应依赖此模式**,人类可读的 rich 输出(表格、颜色、进度条)不是稳定契约,随时可能调整。

`--json` 模式下:

- **stdout 只输出裸 JSON**(单行,无 rich 装饰、无进度条),可直接 `| jq` 处理;
- **错误走 stderr 纯文本**(一行),不污染 stdout;
- **退出码语义**:0 = 成功;非 0(当前统一为 1)= 失败。脚本判断成败看退出码,不要解析错误文本。

各命令的 JSON 输出形状:

| 命令 | stdout JSON |
|---|---|
| `login` | `{"config_path": "...", "base_url": "..."}` |
| `projects list` | Project 对象数组 |
| `projects create` | Project 对象 |
| `datasets create` | Dataset 对象 |
| `datasets upload`(逐文件) | UploadedItem 对象数组 |
| `datasets upload --zip` | ZipUploadResult 对象 |
| `datasets link` | `{"link": LinkResult, "job": Job \| null}` |
| `predictions import` | ImportResult 对象 |
| `jobs wait` | 终态 Job 对象 |
| `jobs cancel` | `{"job_id": "...", "cancel_requested": true}` |
| `ml-backends list` | MLBackend 对象数组 |
| `ml-backends get` | MLBackend 对象 |
| `export project` | `{"job_id": "...", "status": "...", "out": "..."}` |

对象字段与 [SDK 响应模型](./python-client#响应模型与前向兼容)一致(`model_dump(mode="json")` 序列化);服务端新增字段会原样透传,脚本应容忍未知字段。

示例:

```bash
# 创建项目并取回 id
pid=$(aap projects create --name ci-demo --type image --json | jq -r '.id')

# 导入预测,失败时退出码非 0 使 CI 步骤失败
aap predictions import "$pid" preds.json --format aap_json --json
```

## 错误输出约定

所有命令的错误统一为 **stderr 一行提示 + 退出码 1**,不向用户输出 traceback:

| 错误 | 输出 |
|---|---|
| 401 未认证 | `认证失败 (HTTP 401): <detail>; 请先运行 \`aap login\` 配置有效 API key` |
| 其他 HTTP 4xx/5xx | `请求失败 (HTTP <code>): <detail>` |
| SDK 异常(如 job 失败、超时) | 异常消息原文 |
| 网络错误(连接失败、超时) | `网络错误: <原因>` |

非 `--json` 模式下错误以红色渲染;`--json` 模式下为纯文本。
