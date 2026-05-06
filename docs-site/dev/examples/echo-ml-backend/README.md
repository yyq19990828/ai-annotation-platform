# Echo ML Backend（最小协议参考实现）

> 这是 [ML Backend 协议](/dev/ml-backend-protocol) §1-3 的最小可跑参考实现。本目录的 `main.py` 通过 `<!--snippet-->` 注释被协议文档 §8 镜像引用，源端改一字 `pnpm docs:build` 即报漂移。

## 快速开始

### 方式 A · 直接 uvicorn

```bash
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

### 方式 B · Docker

```bash
docker build -t echo-ml-backend .
docker run --rm -p 8000:8000 echo-ml-backend
```

## 验证端点

另起一个 shell：

```bash
./test.sh
# 或显式指定 host：
HOST=http://host.docker.internal:8000 ./test.sh
```

期望输出：3 个端点全部 200，最后打印 `✓ echo-backend 全部端点 200。…`

## 接入平台

在前端 ProjectSettings → ML Backends 添加：
- 平台跑 Docker：`http://host.docker.internal:8000`
- 平台直接本机：`http://localhost:8000`

点「测试连接」应通过。然后在批次详情页触发「AI 预标注」即可看到固定的 demo bbox 落到任务上。

## 把 echo 改成真 backend

`main.py:predict()` 把固定 demo bbox 替换为真实推理调用即可——其它端点（health / setup / versions）的 schema 协议要求不变，照搬。

更复杂场景（异步队列、多模型版本、点 / 框交互式 prompt）参考 [ML Backend 协议 §2.2 / §6 / §7](/dev/ml-backend-protocol)。
