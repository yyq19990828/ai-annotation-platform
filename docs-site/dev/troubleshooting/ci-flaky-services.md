# CI 服务依赖踩坑

GitHub Actions e2e job 跑挂的几个非典型问题，集中归档。

## 症状 1：`bitnami/minio:latest` manifest not found

```
Error response from daemon: manifest for bitnami/minio:latest not found
```

### 根因

Bitnami 撤了该镜像的 manifest，CI 里 `services:` 块再也拉不到。

### 修复

GitHub Actions 的 `services:` 块**不接受 image 的 args**（没法给 `minio/minio` 传 `server` 子命令）。直接在 step 里 `docker run` 最干净：

```yaml
- name: Start MinIO
  run: |
    docker run -d --name minio \
      -p 9000:9000 \
      -e MINIO_ROOT_USER=minioadmin \
      -e MINIO_ROOT_PASSWORD=minioadmin \
      minio/minio:latest server /data

    # 轮询 health 端点直到就绪
    for i in $(seq 1 30); do
      curl -sf http://localhost:9000/minio/health/ready && break
      sleep 1
    done
```

桶 `annotations` 由 FastAPI lifespan `ensure_bucket` 第一次 HeadBucket 失败时自建，无需预建。

## 症状 2：FastAPI lifespan 卡死 30s 后 `/health` 不通

```
ECONNREFUSED 127.0.0.1:8000
```

后续所有 Playwright case 全连不上。

### 根因

E2E job 之前没声明 `minio` service，FastAPI lifespan 里 `boto3.HeadBucket(annotations)` 连不上 `localhost:9000`，botocore 反复重试拉满 30s health-check 窗口，curl 打不通 `/health`。

### 修复

显式定义 minio service（早期沿用 `bitnami/minio` 时）或用上文 `docker run` 方案。FastAPI 必须能在 lifespan 里成功 `HeadBucket` 才会暴露 `/health`。

## 症状 3：E2E IPv6 解析失败

某些 GitHub runner 上 `localhost` 解析到 `::1` 但服务只监听 `0.0.0.0`，导致 connect 失败。

### 修复

显式用 `127.0.0.1`：

```yaml
env:
  API_BASE_URL: http://127.0.0.1:8000
```

## 教训

- **GitHub Actions `services:` 块不能传 args**，需要传命令的服务必须用 `docker run`。
- **lifespan 阻塞会拖垮 health check**。如果某依赖在 CI 里不强制必须，给它加超时 + 降级。
- **`localhost` 在不同环境不等价**，CI 里始终写 `127.0.0.1`。

## 相关

- commit: `b63b192` fix(ci): MinIO 改用 docker run
- commit: `51a84b1` fix(ci): e2e 增加 minio service
- commit: `45da7db` fix(ci): IPv6 解析失败
