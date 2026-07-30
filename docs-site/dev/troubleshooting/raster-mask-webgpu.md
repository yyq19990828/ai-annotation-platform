---
audience: [dev, ops]
type: troubleshooting
status: experimental
last_reviewed: 2026-07-30
---

# Raster Mask WebGPU 未命中或回退 CPU

## 症状

- 开启实验环境变量后，大 ROI morphology 仍显示 `backend=cpu`；
- 诊断显示 `disabled`、`adapter-unavailable`、`initializing`、`budget-insufficient`、`device-lost` 或
  `gpu-runtime-failed`；
- Linux 部署机器有 NVIDIA GPU，但访问页面的浏览器没有命中 WebGPU。

这些状态都不代表 Mask 计算失败。只要 CPU Worker 成功，XOR patch、undo / redo 与保存语义保持一致。

## 先确认资源边界

WebGPU 运行在访问工作台的用户浏览器中，不运行在 API、Celery、PostgreSQL、对象存储或 ML backend
容器中。服务器有 GPU 不会让远程浏览器取得 adapter；反过来，客户端 MacBook 的浏览器可以使用本机
GPU，而 Linux 服务端完全不参与该计算。

`VITE_EXPERIMENTAL_RASTER_MASK_WEBGPU` 是 Vite build-time 开关：

- 默认 `false`，provider module 不加载，adapter 请求次数为 0；
- 修改 `.env` 后必须重建前端 image；只重启 API 或 Celery 不会改变已生成的浏览器 bundle；
- 该开关不是用户设置，也不会启用 WebCodecs 视频硬件解码。

## 诊断状态

| 状态 / reason                | 含义                                                     | 处理                                                                   |
| ---------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------- |
| `disabled` / `gate-disabled` | 当前前端 bundle 关闭实验 gate                            | 如确需试运行，以 `true` 重建前端；否则保持默认                         |
| `initializing`               | adapter / device / pipeline 仍在后台初始化               | 当次操作走 CPU；不要让 UI 等待初始化                                   |
| `adapter-unavailable`        | 浏览器无法取得兼容 adapter                               | 保留 CPU；检查浏览器、OS、驱动与安全上下文，不把服务端 GPU 当作证据    |
| `below-pixel-threshold`      | ROI 小于 `2048²`                                         | 预期行为；小 ROI 使用 CPU 更快                                         |
| `unsupported-operation`      | 不是受支持的 square dilation 或 radius 超界              | 预期 CPU 路由，不扩展 shader 前先跑端到端 A/B                          |
| `budget-insufficient`        | compute 预算无法同时覆盖 JS packed planes 与 GPU buffers | 缩小 ROI或保留 CPU；不要绕过准入预算                                   |
| `device-lost`                | 浏览器报告 device 丢失                                   | 当前请求回退 CPU，provider 保持 lost；切 task 或重建 pool 后再资格探测 |
| `gpu-runtime-failed`         | submit、map、readback 等运行阶段失败                     | 当前请求回退 CPU，provider 不在同一会话反复重试                        |

## 验证默认关闭没有访问 GPU

以默认环境构建后，检查 Raster Mask pool snapshot：

```text
webGpuGateEnabled=false
webGpuState=disabled
counters.initAttempts=0
gpuOwnerWorkers=0
gpuAllocatedBytes=0
```

即使浏览器以可用的 Vulkan / Metal / D3D adapter 启动，这些字段也必须保持零。若出现初始化次数，说明
gate 被错误地运行时化或 provider 被静态导入，应视为回归。

## 研发 A/B

生产 runner 必须连接带对应 gate 的 Vite 页面：

```bash
pnpm --filter @anno/web mask:webgpu-operation-bench
```

强制 Vulkan 只允许用于研发资格实验，不要写入生产 Chrome 启动参数、Docker 配置或默认 Playwright
项目。结果至少核对 XOR patch checksum、save checksum、Long Task、owner 数、allocated bytes plateau 和
dispose 后资源归零；只记录 shader 时间不能作为开启依据。

## 回滚

将 `VITE_EXPERIMENTAL_RASTER_MASK_WEBGPU=false` 后重建前端。CPU Worker session、packed tile、XOR
history 与 canonical COCO RLE 保存路径不依赖该 gate，不需要回滚 API 或数据库。

## 相关

- [标注模块](../concepts/annotation-module)
- [环境变量](../reference/env-vars)
- [ADR-0056](/dev/adr/0056-raster-mask-persistent-client-compute-session)
