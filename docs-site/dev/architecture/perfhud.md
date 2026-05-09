# PerfHud — GPU / ML backend 实时监控浮窗

> v0.9.11 落地. 参考 [ComfyUI-Crystools](https://github.com/crystian/ComfyUI-Crystools) 的"后端 nvml/psutil 推送 → 前端 chart"架构, 不是浏览器侧采集.

## 用途

Grounded-SAM-2 / 未来 SAM-3 等 GPU backend 跑预标时, 运维侧需要实时看 GPU util / VRAM /
温度 / 功耗 + 容器 CPU / RAM 排障 OOM / 卡顿. v0.9.11 之前只能看 60s 缓存的 `health_meta`,
不够实时.

## 触发与权限

- 快捷键: `Ctrl+Shift+P` (全局, 在 `apps/web/src/App.tsx` 注册)
- TopBar: 头像左侧 activity 图标按钮
- 权限: `super_admin` / `project_admin` 才看得见 (annotator / reviewer / viewer 角色既不渲染 toggle 按钮也不渲染浮窗)

## 数据流

```
┌──────────────────────────────────────┐
│ grounded-sam2-backend (GPU 容器)    │
│  /health 端点                          │
│   ├─ pynvml: util / temp / power      │
│   ├─ psutil: cpu_percent / mem        │
│   └─ torch.cuda.mem_get_info: VRAM    │
└────────────┬─────────────────────────┘
             │ HTTP /health
             ▼
┌──────────────────────────────────────┐
│ apps/api Celery beat                  │
│  publish_ml_backend_stats (每 1s)     │
│   1. 读 ml-backend-stats:subscribers │
│   2. 0 订阅者 → skip (节省 GPU 探活) │
│   3. >0 → 拉所有 active backend /health│
│   4. publish ml-backend-stats:global   │
└────────────┬─────────────────────────┘
             │ Redis pub/sub
             ▼
┌──────────────────────────────────────┐
│ apps/api WS /ws/ml-backend-stats     │
│  - admin only (super/project_admin)   │
│  - subscribe / on accept INCR 计数键  │
│  - on close DECR (异常退出走 max(0,)) │
└────────────┬─────────────────────────┘
             │ WS frame (1s 粒度)
             ▼
┌──────────────────────────────────────┐
│ apps/web/src/components/PerfHud/     │
│  useMLBackendStats hook               │
│   - 60s ring buffer (4 metrics)       │
│   - useEffect open WS only when visible│
│  PerfHud.tsx                           │
│   - 280×180 floating panel             │
│   - 4 progress bar + sparklines        │
└──────────────────────────────────────┘
```

## 关键文件

| 层 | 路径 | 改动点 |
|---|---|---|
| GPU backend | `apps/grounded-sam2-backend/observability.py` | 新增 5 个 Gauge + `init_perfhud_collectors` / `sample_perfhud` |
| GPU backend | `apps/grounded-sam2-backend/main.py` `/health` | 调 `sample_perfhud()`, 扩 `gpu_info` + `host` 段 |
| GPU backend | `apps/grounded-sam2-backend/pyproject.toml` | 加 `pynvml>=11.5` + `psutil>=5.9` |
| API schema | `apps/api/app/schemas/ml_backend.py` | 新增 `GpuInfo` / `HostInfo` / `CacheStats` / `HealthMeta` / `MLBackendStatsSnapshot` Pydantic |
| API client | `apps/api/app/services/ml_client.py` | `health_meta()` 透传 `host` 段 |
| API WS | `apps/api/app/api/v1/ws.py` | 新增 `/ws/ml-backend-stats` (admin only + 订阅者计数) |
| API worker | `apps/api/app/workers/ml_health.py` | 新增 `publish_ml_backend_stats` 任务 |
| API beat | `apps/api/app/workers/celery_app.py` | 新增 `publish-ml-backend-stats` schedule (1s) |
| 前端组件 | `apps/web/src/components/PerfHud/` | 浮窗 + hook + zustand store |
| 前端入口 | `apps/web/src/App.tsx` | 全局 `Ctrl+Shift+P` listener + `<PerfHud />` 挂载 |
| 前端入口 | `apps/web/src/components/shell/TopBar.tsx` | activity icon button (admin only) |

## 性能开销

- **后端**: 1s 粒度 publish 仅在 WS 订阅者 > 0 时触发. 单次拉取串行扫描所有
  `state != 'disconnected'` backend, 走现有 `MLBackendClient.health_meta()` (httpx
  AsyncClient + 0 cache, 直拉 backend `/health`). pynvml 采样 < 1ms, psutil 采样 < 5ms,
  GPU 探活通常 5-30ms; 单 backend 单次 ~40ms 内.
- **前端**: 单 WS 订阅, 关闭浮窗即断 (useEffect cleanup). ring buffer 60 帧 × 4 metrics,
  内存占用可忽略. Sparkline 用 SVG polyline (`apps/web/src/components/ui/Sparkline.tsx`),
  无 recharts 依赖.
- **多人观察不放大**: Celery beat 单实例 1s 拉一次, broadcast 给所有订阅者. 即便 10 人
  同时打开 PerfHud, 后端仍仅 1s 1 次实拉.

## 待扩展

- **浏览器侧指标** (FPS / JS heap / longtask / API p95 / WS 重连数 / 当前 task 框数):
  延期到 §C.1 keyset 分页拐点判断时一并加. 当前 backend 视角的 GPU/容器指标已足够
  排预标卡顿/OOM.
- **多变体 backend** (v0.10.x sam3 + grounded-sam2 双 backend): 已支持 select 切换;
  未来加按 `extra_params.variant` 分组显示.
- **历史趋势归档**: 60s ring buffer 仅在浮窗 visible 期间保留, 关闭即丢. 长期趋势看
  Prometheus + Grafana.

## 相关 ADR / 文档

- 上游协议: [ml-backend-protocol.md](../ml-backend-protocol.md)
- 健康检查总策略: [monitoring.md](../monitoring.md)
- 关联 v0.9.6 `health_meta` 缓存: [ai-models.md](./ai-models.md)
