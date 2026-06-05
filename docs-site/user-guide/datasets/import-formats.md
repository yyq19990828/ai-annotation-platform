---
audience: [admin, superadmin]
type: how-to
since: v0.14.2
status: stable
last_reviewed: 2026-06-05
---

# 点云 / 多模态数据集导入格式

本平台**只直接接受自家原生目录约定**;其他数据集格式(nuScenes / KITTI 等)请先用配套转换脚本离线转成原生结构,再上传或直接入库。这与 SUSTechPOINTS、xtreme1 等开源点云标注平台的做法一致——它们也不在上传端做格式适配,而是提供一次性转换脚本。

> 为什么不做"通用导入器":真实用户的点云数据来源高度异构(nuScenes / Waymo / KITTI / 自采),每种都有独立的标定坐标系与文件布局。"用 UI 导入任意格式"是伪需求——成熟平台都让用户先离线转换。平台聚焦把**原生格式**这条路走顺,再为常见数据源各配一个转换脚本。

## 平台原生目录约定

一个点云 / 多模态 scene 的目录结构(storage key 前缀是 `<dataset_name>/`):

```
<dataset_name>/lidar/<frame>.pcd               # 点云帧(file_type=point_cloud)
<dataset_name>/camera/<cam>/<frame>.jpg         # 各相机同帧图像(file_type=image)
<dataset_name>/calib/camera/<cam>.json          # 每相机一份标定(对该相机所有帧通用)
```

- **帧 id = 文件名 stem**(去扩展名),如 `000970`。lidar 与各相机的同一帧必须用**相同的文件名 stem**,平台据此把它们归到一帧(`group_frames`)。
- **相机名 = `camera/` 后那一段**,如 `front` / `left` / `CAM_FRONT`。
- `calib/camera/<cam>.json` 对该相机的所有帧通用。

真实例子(SUSTechPOINTS 示例 scene):

```
pc-scene-dev/lidar/000970.pcd
pc-scene-dev/lidar/000971.pcd
pc-scene-dev/camera/front/000970.jpg
pc-scene-dev/camera/left/000970.jpg
pc-scene-dev/calib/camera/front.json
pc-scene-dev/calib/camera/left.json
```

### 顶层多子目录 = 多 scene

当 ZIP / dataset 顶层**不是**角色目录(`lidar/` `camera/` `calib/` `image/` `video/`)、而是若干"场景名"子目录、每个子目录里再各含自己的 `lidar/ camera/ calib/` 时,平台判定为**多 scene**,每个顶层子目录建成一个独立 scene:

```
nu-mini-multi/scene-0061/lidar/...      # scene "scene-0061"
nu-mini-multi/scene-0061/camera/...
nu-mini-multi/scene-0103/lidar/...      # scene "scene-0103"
nu-mini-multi/scene-0103/camera/...
```

scene 边界与 `frame_index` 的概念详见 [Scene + frame_index 跨 task 帧序列地基](/dev/concepts/scene-and-frame-index)。要点:

- 上传 / 入库完成后,**每个 dataset 自动至少有 1 个 scene**(角色目录布局 → 单 scene,名取 dataset 名)。
- **一个 dataset 可以装多个 scene**;scene 边界由 importer / 目录布局决定。
- scene 内 `frame_index` 决定跨帧导航(`Shift+→` 延续、邻帧叠加)的顺序;跨 scene 不串(scene-A 末帧的"下一帧"为空,不会跳到 scene-B 首帧)。

> ⚠️ **不要**把 `lidar` / `camera` / `calib` / `image` / `video` 用作顶层 scene 目录名——它们是角色目录的保留名,会让多 scene 启发式误判为单 scene。

## 上传方式

### A. 浏览器 ZIP 上传(向导)

在数据集导入向导选 **3D 点云** 类型,上传一个 ZIP 包。**打包时必须保留 `lidar/ camera/ calib/` 三级子目录**(v0.14.2 起 ZIP 上传保留 ZIP 内子目录,不再拍平到 basename)。

- **默认一个 ZIP = 一个 scene**,除非顶层有多个非角色子目录(见上)。
- 上传上限沿用现有 200MB 整包 / 100MB 单文件;nuScenes 单 scene(~80MB)够用,多 scene 请走转换脚本而非向导。
- 跨子目录同名文件(如 `camera/front/000970.jpg` 与 `camera/left/000970.jpg`)按 **content_hash** 去重,同名不冲突——同帧号跨相机是合法的。

### B. 命令行脚本入库

不走向导、直接灌进当前栈(MinIO + DB)。范例见 [`apps/api/scripts/seed_pointcloud.py`](https://github.com/yyq19990828/ai-annotation-platform/blob/main/apps/api/scripts/seed_pointcloud.py)(SUSTechPOINTS 示例)与下文 nuScenes 脚本。

## 标定 JSON schema

`calib/camera/<cam>.json` 经 `SensorCalibration` 校验,三个字段:

| 字段 | 类型 | 说明 |
|---|---|---|
| `extrinsic` | 16 float(row-major) | lidar → camera 的 4×4 外参齐次矩阵 |
| `intrinsic` | 9 float(row-major) | 相机内参 3×3 矩阵 K |
| `rect`(可选) | 16 float | KITTI 风格 4×4 矫正矩阵;非 KITTI 数据不填 |

非 schema 字段(上游 / 厂商夹带的杂键)入库时自动剥除,不会让一份合法标定整体作废。实例(SUSTechPOINTS `front.json`,截断):

```json
{
  "extrinsic": [-0.9994, 0.0330, -0.0039, 0.2049,
                 0.0025, -0.0419, -0.9991, 0.0014,
                -0.0332, -0.9986, 0.0418, -0.1094,
                 0, 0, 0, 1],
  "intrinsic": [1210.06, 0.0, 1022.43,
                0.0, 1205.85, 792.54,
                0.0, 0.0, 1.0]
}
```

## 从其他数据集转换

### SUSTechPOINTS / xtreme1 自家格式

目录布局已符合平台约定,**直接 ZIP 上传**(一个 ZIP 默认单 scene)。

### nuScenes

用配套脚本 [`apps/api/scripts/import_nuscenes_scene.py`](https://github.com/yyq19990828/ai-annotation-platform/blob/main/apps/api/scripts/import_nuscenes_scene.py) 离线转换 + 直接入库。脚本**按 nuScenes scene_token 自动建多 scene**,scene_token 1:1 落到 `scenes.name`,sample 顺序赋 `frame_index`:

```bash
cd apps/api
# 单 scene
uv run python scripts/import_nuscenes_scene.py \
  --nuscenes-root /data/nuscenes-mini --scene-tokens scene-0061 \
  --dataset-name nu-scene-0061
# 多 scene 共用一个 dataset
uv run python scripts/import_nuscenes_scene.py \
  --nuscenes-root /data/nuscenes-mini --scene-tokens scene-0061,scene-0103,scene-0553 \
  --dataset-name nu-mini-multi
```

脚本只依赖 numpy + Pillow,不需要 `nuscenes-devkit`。数据集下载见 [nuscenes.org/nuscenes#download](https://www.nuscenes.org/nuscenes#download)(选 mini split)。

> **坐标系**:nuScenes 的 **ego(车体)系**才是 ISO 8855,但脚本上传的是未变换的 **LIDAR_TOP 传感器系**原始点,其约定为 +X 车右 / +Y 车前 / +Z 天 = **`apollo`**(已用 LIDAR_TOP→ego 标定旋转印证,且 `sniff-axis-convention` 取正前相机 `CAM_FRONT` 时给 apollo、score 1.0)。因此脚本设 `axis_convention=apollo`,由前端旋转到 ISO 显示,BEV 才车头朝上;`cam_from_lidar` 外参与 raw 点一致,投影不受影响。
>
> ⚠️ 实测发现 `sniff-axis-convention` 在多相机装置上结果随所抽相机而变(`CAM_FRONT`→apollo,`CAM_FRONT_RIGHT`→iso_8855)。**别用单次 sniff 给 nuScenes 这类多相机数据定约定**,以已知传感器装置(apollo)为准。

### KITTI

本版本暂未提供 KITTI 转换脚本。社区参考:SUSTechPOINTS 的 `tools/trans_kitti_labels.py`([第三方源码](https://github.com/naurril/SUSTechPOINTS/blob/master/tools/trans_kitti_labels.py))——目录树与本平台不完全一致,作为转换思路参考,不直接照搬。

## axis_convention(坐标系约定)怎么选

不同数据源的 lidar/world 坐标系约定不同,选错会导致 BEV 俯视下车头不朝上。详见 [点云数据集的 lidar 坐标系约定](/user-guide/datasets/lidar-axis-convention)。可用 `POST /api/v1/datasets/{id}/sniff-axis-convention` 端点对样本帧自动嗅探。
