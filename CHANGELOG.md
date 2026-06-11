# Changelog

本文件记录 AI 标注平台的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

历史版本详情见 [`docs/changelogs/`](docs/changelogs/)：

| 版本组 | 文件 |
|--------|------|
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

## 最新版本

<!-- 0.15.x 版本变更按版本段追加到本区；进入 0.16.x 后整体移到 docs/changelogs/0.15.x.md -->

## [0.15.5] - 2026-06-11

视频工作台设置切片。`workbench.video.*` 增加默认播放速率和大步进帧数;关键帧传播与 AI Tracker 传播对话框按用户记住上次选择;WebCodecs 实验开关进入视频任务的工作台设置抽屉。计划见 `docs/plans/2026-06-11-v0.15.5-video-workbench-settings.md`。

### Added

- **视频设置字段**:工作台设置抽屉与个人设置页新增默认播放速率、大步进帧数;默认值保持 1x 和 10 帧。
- **传播对话框粘性记忆**:关键帧传播记住数量 / 方向 / 覆盖选项;AI Tracker 传播记住范围 / 方向 / 模型 / SAM 尺寸,取消或提交失败不回写。
- **WebCodecs 设置入口**:视频任务抽屉新增「实验特性」分组,直接读写既有 `video.experimental.webcodecs` localStorage 开关,刷新后生效。

### Changed

- 时间轴聚焦时 `Shift+←/→` 的大步进支持 5 / 10 / 30 帧或采样网格;`grid` 模式在采样开启时跳一个采样单元,否则回退 10 帧。

## [0.15.3] - 2026-06-11

工作台设置体系地基(epic v0.15.3–v0.15.7 第一版)。`WorkbenchPreferences` 从平铺字段重构为 **通用/图片/视频/点云** 四子树,工作台内立起「设置抽屉」(齿轮菜单入口、改动实时预览),Settings 页「标注偏好」同步改为注册表驱动的分组渲染。**本版不新增任何用户可感知设置项**,只做结构 + 归位,所有默认值与原硬编码一致。计划见 `docs/plans/2026-06-11-v0.15.3-preferences-schema-and-settings-shell.md`。

### Added

- **工作台设置抽屉**:齿轮菜单 →「工作台设置」,按「通用 + 当前模态」分组,改动本地立即生效(画布实时预览)+ 300ms 防抖 PATCH;被项目锁定的字段禁用 + 「项目锁定」badge。
- **字段注册表** `workbenchSettingsFields.ts`:设置 UI 单一来源(key/分类/控件/可锁定),抽屉与 Settings 页共用 `SettingsFieldControl` 渲染;后续版本新增设置项 = 注册表加一行。

### Changed

- **偏好四分树**:`workbench.{smoothImage,cssImageFilter,controlPointsSize,snapToGrid}` → `workbench.image.*`;`longTaskSampleRate` → `workbench.common.*`;`layout` 保持顶层。存量 JSONB 由迁移 0103 就地改写(up/down 可逆、幂等);`ProjectRenderingConfig` 保持平铺,合并逻辑映射到 `image.*` 子树。
- Settings 页「标注偏好」改为注册表驱动的四分组(空分组不渲染),与抽屉读写同一份数据。

### Notes

- 部署窗口期:已打开的旧前端 tab PATCH 平铺键会被服务端 legacy 提升器接住(v0.16 移除);旧 tab GET 到新形态后渲染默认值,刷新即愈。

## [0.15.1] - 2026-06-10

跨帧插值 + 多目标批量 propagate。在 v0.15.0 的 ego 地基上,把 v0.14.1 的「`Shift+→` 逐帧手搬框」升级成「ego 运动补偿 + 关键帧插值 + 批量」,减少长 scene 的逐帧重复劳动。计划见 `docs/plans/2026-06-06-v0.15.1-crossframe-interpolation-and-batch-propagate.md`。

### Added

- **运动补偿 propagate**:`Shift+→`/`Alt+→` 跨帧延续 box_3d 时,若源/目标帧均有 ego pose,由「世界位置不变」反算目标帧 PSR——静止物在下一帧自动套住目标;无 pose 的 scene 退化为 v0.14.1 原样复制(零回归),响应带 `motion_compensated` 标记,前端轻提示一次。几何核心 `services/ego_transform.py` 纯函数(euler 与前端 three.js 锁步)+ 重点单测。
- **多目标批量 propagate**:`POST /tasks/{id}/annotations/propagate-batch`(annotation_ids=null → 全部 active box_3d),整批一个事务;3D 工作台 `Ctrl+Shift+→/←` 或「跨帧工具」面板触发。
- **关键帧区间插值**:`POST /tasks/{id}/annotations/interpolate-range`(body `{group_id, to_task_id}`)——同 group 链两端框之间,中间帧自动生成插值框(世界系线性内插中心 + slerp 朝向 + 线性尺寸);生成框 `source="interpolated"` 便于审核过滤;已有同 group 的中间帧幂等跳过;中间帧锁态整批拒。前端「跨帧工具」面板提供「延续到帧(建链)→ 微调 → 插值填充」工作流。
- **邻帧 overlay ego 对齐**:`GET /scenes/{id}/trajectory` 进前端(`useSceneTrajectory` + `egoAlign.ts`),邻帧参考框先变换到当前帧 ego 系再叠加——静止物历史/未来框与当前帧重合,偏移即目标真实运动。

### Notes

- `point_mask_3d` 跨帧明确不做(点索引跨帧无意义);Kalman / 非线性运动模型留后续。
- 真实数据验证:scene-0061(39 帧)首尾两帧静止物插值 37 帧,世界中心偏差 < 1e-15 m。

## [0.15.0] - 2026-06-10

ego_pose / 时间戳数据地基。给 scene 加"车体随时间的位姿轨迹 + 逐帧时间戳"(nuScenes `ego_pose` / `sample_data.timestamp` 的平台等价物),本版只立地基、回填、透出,不做跨帧 UX(消费留 v0.15.1)。计划见 `docs/plans/2026-06-06-v0.15.0-ego-pose-temporal-foundation.md`。

### Added

- **`scene_frame_poses` 表**(迁移 0102):grain = `(scene_id, frame_index)` 一帧一行,存 ego→global 的 `ego_translation [x,y,z]` / `ego_rotation [w,x,y,z]` + LIDAR_TOP 微秒时间戳;FK CASCADE + 复合唯一约束。历史 scene / 非 nuScenes 来源无行,消费方按"无轨迹"降级。
- **trajectory API**:`GET /api/v1/scenes/{id}/trajectory` 返回按 `frame_index` 升序的逐帧位姿;无位姿 scene → 200 + `poses: []`。
- **manifest 透出**:`GET /tasks/{id}/point-cloud/manifest` 新增 `ego_pose` 字段(本帧 translation / rotation / timestamp_us,无则 null);本版前端仅调试可见,不消费。
- **importer 回填**:`import_nuscenes_scene.py` 落 scene 后逐帧 upsert ego pose + 时间戳(读 `ego_pose.json` + `sample_data.timestamp`,幂等)。
- **backfill 脚本**:`scripts/backfill_frame_poses.py --dataset-id <uuid|display_id> --nuscenes-root <root>` 给 v0.15.0 之前导入的 nuScenes dataset 补 pose 行,按 `scene.source_metadata.scene_token` 反查原元数据,可重跑。
