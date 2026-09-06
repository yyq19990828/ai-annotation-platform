# 点云空间分块与流式加载计划草案

> Status: trigger-gated research-draft
>
> Implementation authorization: no
>
> Version: unassigned；本草案不占版本号
>
> Finalization: 实施前必须执行 [`backlog/README.md`](README.md) 的“转定稿门”

## 1. 推荐结论

推荐在固定性能基线证明现链路不达标后，引入**离线生成、内容不可变的空间 LOD tile + WebGL 视口选择 + Worker 解码 + 页签级 LRU**。小点云继续使用现有 PCD 直读，大点云按 manifest 进入流式路径；WebGPU 不作为第一版前提。

核心约束不是“能显示更多点”，而是无论 tile 如何换入换出，`point_mask_3d`、框选、自动拟合和质量检查都使用稳定的全局点身份，不能把当前渲染数组下标误当数据真值。

## 2. 当前基线快照

- `usePointCloudManifest` 当前返回一个主点云预签名 URL、相机、标定、scene 与 pose，不是空间 tile manifest。
- `PointCloudScene.loadPcd` 使用 Three.js `PCDLoader` 先加载并解析完整点云，再按 `decimateThreshold` 均匀抽样到新的 positions 数组。
- 当前点掩码通过 `decimate_stride` 和 `source_point_count` 把渲染点映射回源 PCD 顺序；这个合同只在“单文件、固定顺序、固定 stride”下成立。
- 邻帧点云、地面估计、autofit、屏幕选择和颜色映射都直接消费当前内存 positions。流式化会影响多个组件，不能只替换 loader。

## 3. 触发门与基线

转定稿前固定三套能长期保存的数据集：约 100 万、1,000 万和 5,000 万点，并在同一硬件、浏览器、相机轨迹下记录：

- 首次可交互时间、完整文件下载字节和首屏下载字节。
- 稳定 / P95 FPS、主线程 long task、Worker 时间。
- JS heap、ArrayBuffer、GPU buffer 和页签峰值内存。
- 对象选中、框选、自动拟合和点掩码编辑延迟。
- 切 task、切 scene、反复视角移动后的资源释放与缓存命中。

只有 1,000 万或 5,000 万点场景在目标机器上超过定稿给出的预算，且调低现有渲染阈值无法满足精度时，才实施 tile 基础设施。基线达标则保留当前简单链路。

## 4. 数据合同

```text
Immutable source PCD + axis convention
                 │ offline build, content digest
                 ▼
     Immutable spatial tile generation
       ├─ manifest: bounds / hierarchy / attributes / counts
       ├─ tile objects: positions / optional attrs / global point IDs
       └─ source digest + generator version
                 │ signed manifest / batched URLs
                 ▼
 View frustum + screen error selector ─► fetch scheduler ─► Worker decode
                 │                            │                 │
                 └──────────────► page budget / LRU ◄───────────┘
                                                   │
                                                   ▼
                                       WebGL buffers + edit pin set
                                                   │
                                                   └─► global ID based annotations
```

manifest 至少描述：版本、源内容摘要、坐标约定、根包围盒、层级 / tile id、每 tile 包围盒、点数、属性 schema、编码、字节大小和对象引用。tile 内每个可编辑点必须能无歧义恢复为源点全局 ID；若生成器重排点，则显式存 global-id stream。

生成物使用 source digest + generator version 形成不可变 generation。新 generation 不覆盖旧对象；活跃 annotation 仍指向其点身份合同，迁移必须有对账工具。

## 5. 运行时策略

- 根据视锥、屏幕空间误差和预算选择 tile；相邻方向小规模预取，快速甩动时取消低优先级请求。
- 网络、解码、CPU positions 和 GPU buffer 分开计费；LRU 只淘汰可重建资源，不淘汰未保存编辑真值。
- 选中对象、点掩码编辑 ROI、自动拟合 ROI 对应 tile 进入 pin set；操作结束后释放 pin。
- 框选和 point pen 只能对“本次操作声明的完整分辨率 ROI”提交。缺 tile 时显示加载进度或拒绝提交，不能把未加载点当背景。
- 高度色、地面估计和场景鲁棒边界使用 manifest 聚合或明确的全局抽样，避免每次等全部叶子 tile。
- 小文件继续走 PCDLoader；两条路径在几何、颜色、轴约定和点 ID fixture 上对拍。

## 6. 范围

- 离线 tile generator、不可变对象布局、manifest 与生成状态。
- manifest / URL API、访问控制、范围限制和清理对账。
- 前端 tile selector、请求调度、Worker 解码、WebGL buffer 管理与 LRU。
- 全局点 ID、编辑 pin、ROI 完整性和 point mask 兼容迁移。
- 固定三档 benchmark、诊断快照和 legacy PCD fallback。

## 7. 非范围

- 不在请求时动态切 PCD，不让 API 进程承担大文件解码。
- 不以 WebGPU 重写渲染器；只有 WebGL 路线有可复现瓶颈时另立决策。
- 不同时引入多 LiDAR 融合、mesh、NeRF、Gaussian Splatting 或服务端远程渲染。
- 不为了 tile 改变 annotation geometry 或默默重编号历史点掩码。
- 不承诺离线生成阶段零额外存储；存储换首屏与内存收益必须单独计量。

## 8. 推荐实现切片（转定稿后执行）

1. **基准与格式原型**：只做可重复 benchmark、离线生成器和 manifest validator，不接生产工作台。
2. **只读流式查看**：大点云视口 LOD、Worker、LRU、诊断；小点云保持旧路径。
3. **box 编辑兼容**：选择、聚焦、autofit 的完整 ROI 与 pin，验证不因换 tile 漂移。
4. **point mask 真值兼容**：全局 ID、增删点、撤销、导出和旧 stride 数据迁移 / 共存。
5. **生产与清理**：生成队列、失败恢复、对象生命周期、文档和容量告警。

每一切片通过后才进入下一切片；只读流式查看不能被宣传为已支持点级编辑。

## 9. 验收方向

- 5,000 万点数据首次可交互前无需下载或解析完整源文件，首屏字节和峰值内存受冻结预算约束。
- 固定相机轨迹下没有明显 tile 闪烁、重复点或空洞；LOD 切换不改变 annotation 位置。
- 同一组全局点 ID 在旧 PCD 路径、tile 路径、刷新、不同 LOD 和导出中一致。
- 编辑 ROI 未完整加载时无法提交；完整后框选 / pen 的结果不因 tile 淘汰丢点。
- 切换 20 个 task 后 CPU / GPU / URL 资源回到预算内，无持续增长。
- WebGL 不可用、tile 生成失败、manifest 版本未知和单 tile 损坏均有安全降级或明确失败。

## 10. 风险与回滚

- 最大风险是显示正确但点级真值损坏。全局 ID 和双路径对拍必须早于 point mask 接入。
- tile 生成与源文件生命周期可能形成孤儿对象；需要 generation 引用计数 / 对账和延迟清理。
- 回滚按数据集切回 legacy PCD URL；不可删除仍被 annotation generation 引用的 tile。已经生成的派生资产可延迟清理，不影响源数据。

## 11. 转定稿专项检查

- 重新跑三档 benchmark，并保存浏览器、GPU、驱动、机器、数据摘要和相机轨迹；旧数字不能直接复用。
- 审计届时的点掩码存储、导出和 quality 规则，写 ADR 冻结 global point ID 与 generation 兼容。
- 检查现有图片 tile / 资源协调基础设施能复用哪些通用模式，但不把 raster tile 数据结构强套点云。
- 定稿必须显式确认超过 8 文件和多组件变更面，给出逐切片精确文件、迁移、容量、测试和回滚清单。
