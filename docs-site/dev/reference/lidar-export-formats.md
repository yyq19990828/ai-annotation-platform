---
audience: [developer, ml_engineer]
type: reference
since: v0.14.7
status: stable
last_reviewed: 2026-06-07
---

# LiDAR Export Formats

LiDAR projects can export five targets:

| Target      | Purpose                                   | Coordinate frame        |
| ----------- | ----------------------------------------- | ----------------------- |
| `aap_json`  | Platform-native lossless JSON             | API `axis_frame` option |
| `coco`      | Per-camera 2D boxes derived from `box_3d` | Image pixels            |
| `kitti`     | KITTI 3D detection labels                 | Selected KITTI camera   |
| `nuscenes`  | nuScenes-style temporal training tables   | Global                  |
| `pointmask` | Per-point semantic labels                 | Point index order       |

These targets are pure serializers. They do not add database tables, columns, or
migrations. Existing AAP JSON export remains unchanged.

## Common Package Files

The standard LiDAR targets write annotations and manifests, not embedded media
bytes. This matches the existing image/video export policy and keeps large scenes
small.

| File                              | Description                                            |
| --------------------------------- | ------------------------------------------------------ |
| `classes.txt`                     | Project class list                                     |
| `attribute_schema.json`           | Project attribute schema, when attributes are included |
| `images_manifest.json`            | Camera image presigned URLs                            |
| `pointclouds_manifest.json`       | Primary point-cloud presigned URLs                     |
| `fetch_images.py`                 | Downloads camera images into `images/`                 |
| `fetch_pointclouds.py`            | Downloads point clouds into `velodyne/`                |
| `calib_raw/<camera>/<frame>.json` | Raw `SensorCalibration` payload                        |

For multi-target exports, each target is placed under its own `{target}/`
subdirectory.

## KITTI 3D

KITTI export writes:

```text
label_2/<frame>.txt
calib/<frame>.txt
calib_raw/<camera>/<frame>.json
```

Each `label_2` line has 15 KITTI fields:

```text
type truncated occluded alpha x1 y1 x2 y2 h w l x y z ry
```

AAP stores `box_3d` PSR in ISO coordinates: +X forward, +Y left, +Z up. KITTI
labels always use the explicitly selected camera. The serializer normalizes the
dataset axis convention, applies that role's persisted extrinsic and optional
rectification, then derives the camera-frame bottom center, dimensions,
`rotation_y`, `alpha`, and image-clipped bbox. The API `axis_frame` option does
not change KITTI camera coordinates.

`truncated` and `occluded` are read from `annotation.attributes`. Missing values
default to `0.0` and `0`.

`GET /projects/{project_id}/lidar-camera-roles?batch_id=` reports frame,
calibration, and image-size coverage by exact `TaskDatasetItemLink.role`. One
complete role is selected automatically. Multiple complete roles require the
caller to pass `lidar_camera_role` to project or batch export. Missing role,
calibration, dimensions, or visible projection fails the export at the first
affected frame; placeholder matrices and bboxes are never written.

## COCO 2D

COCO export visits every camera role with valid calibration and image size. It
creates one `images[]` row per frame-camera pair and derives bbox/area directly
from each visible `box_3d`. The generated attributes preserve user attributes
and add `__source_box_3d_id`, `__track_id`, and `__camera_role` provenance.

`images[].file_name` is
`{camera_role}/{frame_key}/{source_name}`. `info.skipped_annotations` counts
boxes behind the camera or clipped to zero area; `info.skipped_cameras` counts
camera frames without valid calibration or dimensions. This serializer never
inserts 2D annotations into the database.

## nuScenes JSON

nuScenes export writes lightweight table files:

```text
sample.json
sample_annotation.json
scene.json
category.json
attribute.json
visibility.json
instance.json
sensor.json
calibrated_sensor.json
sample_data.json
ego_pose.json
```

`Scene`, `DatasetItem.frame_index`, and `SceneFramePose` are required truth.
Samples and camera sample data carry persisted timestamps and per-scene
`prev`/`next` chains. Ego poses are exported unchanged, while box centers and
orientations are transformed from ego/ISO into global coordinates. Instances
are scoped by scene and track id, with first/last/count plus annotation
`prev`/`next` links. Missing scene, frame index, timestamp, or ego pose fails
closed instead of emitting a placeholder.

This is an AAP nuScenes-style training subset. It does not claim map, log, or
other nuScenes tables that the platform does not store.

`visible` or `visibility` attributes map to visibility tokens when present.
Missing visibility exports as an empty token.

## Point Mask

Point-mask export writes:

```text
segmentation/<frame>.label
category_map.json
```

`segmentation/<frame>.label` is a little-endian uint32 array. Index `i` is the
class id for point `i` in the fetched point cloud. Class ids are 1-based, and
`0` means unlabeled/background.

Do not use labels with a different point-cloud file. The index order is only
guaranteed for the point cloud referenced by `pointclouds_manifest.json`.

## Target Validation

`clean_export_targets(..., data_type="lidar")` accepts only:

```text
aap_json, coco, kitti, nuscenes, pointmask
```

The name `kitti` is shared with video projects, but the serializers are separate:

| Project data type | `kitti` meaning           |
| ----------------- | ------------------------- |
| `video`           | KITTI tracking 2D labels  |
| `lidar`           | KITTI 3D detection labels |
