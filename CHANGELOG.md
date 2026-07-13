# Changelog

本文件记录 AI 标注平台的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

历史版本详情见 [`docs/changelogs/`](docs/changelogs/)：

| 版本组 | 文件 |
|--------|------|
| 0.21.x | [docs/changelogs/0.21.x.md](docs/changelogs/0.21.x.md) |
| 0.20.x | [docs/changelogs/0.20.x.md](docs/changelogs/0.20.x.md) |
| 0.19.x | [docs/changelogs/0.19.x.md](docs/changelogs/0.19.x.md) |
| 0.18.x | [docs/changelogs/0.18.x.md](docs/changelogs/0.18.x.md) |
| 0.17.x | [docs/changelogs/0.17.x.md](docs/changelogs/0.17.x.md) |
| 0.16.x | [docs/changelogs/0.16.x.md](docs/changelogs/0.16.x.md) |
| 0.15.x | [docs/changelogs/0.15.x.md](docs/changelogs/0.15.x.md) |
| 0.14.x | [docs/changelogs/0.14.x.md](docs/changelogs/0.14.x.md) |
| 0.13.x | [docs/changelogs/0.13.x.md](docs/changelogs/0.13.x.md) |
| 0.12.x | [docs/changelogs/0.12.x.md](docs/changelogs/0.12.x.md) |
| 0.11.x | [docs/changelogs/0.11.x.md](docs/changelogs/0.11.x.md) |
| 0.10.x | [docs/changelogs/0.10.x.md](docs/changelogs/0.10.x.md) |
| 0.9.x | [docs/changelogs/0.9.x.md](docs/changelogs/0.9.x.md) |
| 0.8.x | [docs/changelogs/0.8.x.md](docs/changelogs/0.8.x.md) |
| 0.7.x | [docs/changelogs/0.7.x.md](docs/changelogs/0.7.x.md) |
| 0.6.x | [docs/changelogs/0.6.x.md](docs/changelogs/0.6.x.md) |
| 0.5.x | [docs/changelogs/0.5.x.md](docs/changelogs/0.5.x.md) |
| 0.4.x | [docs/changelogs/0.4.x.md](docs/changelogs/0.4.x.md) |
| 0.3.x | [docs/changelogs/0.3.x.md](docs/changelogs/0.3.x.md) |
| 0.2.x | [docs/changelogs/0.2.x.md](docs/changelogs/0.2.x.md) |
| 0.1.x | [docs/changelogs/0.1.x.md](docs/changelogs/0.1.x.md) |


---

## [Unreleased]

<!--
日常变更（含普通 bug 修复）按 Keep a Changelog 类型分组追加到本段：
Added / Changed / Deprecated / Removed / Fixed / Security（按此顺序，空组省略）。
发版时把「## [Unreleased]」重命名为「## [x.y.z] - 日期」，再在其上方留一个空的
「## [Unreleased]」。0.22.x 版本段累积在本区；进入 0.23.x 后整体移到 docs/changelogs/0.22.x.md。
-->

### Added
- **视频 AI 追踪对话框新增「本次影响」摘要**:发起前即显示本次会延展选中轨迹还是新建轨迹、各新建几条;文本检测模式额外提示新目标将继承源轨迹类别,避免「选中 car 轨迹却按文本检测行人」时类别被误标。

### Changed
- **视频「AI 追踪」功能对外命名统一**:工作台此前混用「AI 传播 / 发起传播 / AI 追踪传播」指代同一个视频追踪能力,既与另一套纯几何的「标注传播」撞名,又让「传播」盖过了实际的多目标追踪语义。现统一为「AI 追踪」(主按钮「开始追踪」、时间轴泳道「AI 追踪」、方向与错误提示同步),交互与后端行为不变。

## [0.22.0] - 2026-07-13

### Added
- **视频工作台新增原生栅格 Mask 轨迹与 DAVIS 导出**：标注员可用 `M` 在当前帧创建或编辑逐像素 Mask 关键帧，笔刷 / 橡皮支持逐 stroke 撤销重做，帧间按 hold 语义显示并以 alpha 精确选择；SAM2 / SAM3 tracker 可直接产出 Mask 候选，接受前后保持同一 RLE。Mask 使用内容寻址存储并支持 AAP JSON 无损迁移、Video JSON、COCO RLE、bbox-only 外接框降级及标准 DAVIS Full-Resolution palette PNG；导出包内不同 target 可保留各自帧编号规则。

### Fixed
- **视频 Mask 笔刷现在按视频固有分辨率保存**：视频工作台此前错误复用了尚未初始化的图片舞台尺寸，编辑 buffer 会退化成 1×1；绘制后虽然显示“未保存”，实际没有像素、确认也不会提交。上传后创建轨迹时，等价的元组尺寸也会被误判不匹配并返回 500。现视频任务从 manifest 取得宽高，服务端同时接受规范化后的尺寸序列，笔刷叠加与 Mask 轨迹保存恢复正常。
- **视频追踪任务刷新后不再卡在「运行中」**：页面刷新时若登录态尚未恢复，运行中的追踪任务不会重连进度通道，UI 会一直显示 running、不冒出「完成待接受」，直到用户手动切走再切回。现登录态到位后会自动补连尚未连接的运行中任务。
- **跨任务切换不再把上一个任务的 AI 候选挂到新任务画布**：在追踪候选预览请求在途时切到新任务，回来的候选此前会写成孤儿，并可能因视频项目跨任务共用 track / annotation id 而渲染到新任务、令接受 / 丢弃按钮打到旧任务的作业。现按任务归属校验后再写入。
- **大任务打开 Data Manager「匹配详情」不再拉全表**：匹配抽屉的标注 / 预测候选 / 追踪作业三路查询此前无分页、全量物化进内存再切片，含数万条标注的任务即使只取一页也会内存尖峰、阻塞事件循环。现把分页下推到 SQL（预测候选也只对当前页做昂贵的形状转换），返回结构、总数与排序不变。
- **等值属性不再被误判为「不一致」**：Scene 轨迹聚合此前用 `repr()` 比较字典 / 列表型属性值，键顺序不同的等值对象（如导入 JSON 与编辑器写回）会被错标 `inconsistent_attributes` 并丢掉该字段的公共值。现改用规范化 JSON（键排序）比较。
- **失效的内置任务视图现在能说明原因**：当内置视图引用了已删除的属性字段而失效时，前端此前只拿到空数量、拿不到失效字段名。现内置视图与保存视图一致回传 `invalid_fields`。
- **COCO 逐帧分割导出不再静默把未知类名并进 0 号类别**：类名缺失 / 被删 / 为空的标注此前会静默落到 `category_id=0`——删类后的旧标注会污染训练集，项目未定义类时还会产生让 `pycocotools` 加载即 `KeyError` 的悬空引用。现改为跳过该标注，并在导出摘要与日志中汇总被跳过的数量与类名。
- **Data Manager 图表柱条在主题切换后正确换色**：任务状态柱条颜色此前被 `useMemo` 空依赖缓存，浅色主题打开图表再切深色时柱条仍是浅色、与深色卡片对比失衡。现跟随主题重算。
- **从 Data Manager 跳入工作台后不再被 URL 焦点反复拉回**：带 `?focus=…&frame=…` 进入工作台后，用户改选别的标注 / 帧，随后任何标注增删改触发的刷新此前会把选中与帧位置拉回 URL 初值。现 URL 焦点仅在首次命中时应用一次。
- **`project_task_views` ORM 补齐 0119 新增的复合索引**：`ix_project_task_views_scope_visibility` 此前只存在于迁移、未声明进 ORM，导致测试建表缺索引、`alembic --autogenerate` 与生产库反向漂移。现已在模型侧对齐。
