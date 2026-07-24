---
audience: [developer, ml_engineer]
type: reference
since: v0.14.7
status: stable
last_reviewed: 2026-06-07
---

# LiDAR Export Formats

LiDAR projects can export four targets:

| Target      | Purpose                            | Coordinate frame        |
| ----------- | ---------------------------------- | ----------------------- |
| `aap_json`  | Platform-native lossless JSON      | API `axis_frame` option |
| `kitti`     | KITTI 3D detection labels          | KITTI camera            |
| `nuscenes`  | nuScenes-style single-frame tables | AAP ego/ISO             |
| `pointmask` | Per-point semantic labels          | Point index order       |

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
labels always need camera coordinates: +X right, +Y down, +Z forward. The
serializer therefore maps each box through
`unapply_to_psr(psr, "kitti_camera")` regardless of the export API
`axis_frame` value.

`truncated` and `occluded` are read from `annotation.attributes`. Missing values
default to `0.0` and `0`.

When a frame has no persisted calibration, the calib file is written as
`calib/<frame>.unverified.txt` (instead of `calib/<frame>.txt`) and its content
is prefixed with a `# AAP WARNING:` comment. The matrices are identity
placeholders and must not be used for 3D→2D projection — the distinct filename
keeps downstream pipelines from silently consuming them as real calibration.

## nuScenes JSON

nuScenes export writes lightweight table files:

```text
sample.json
sample_annotation.json
category.json
attribute.json
visibility.json
instance.json
calibrated_sensor.json
sample_data.json
ego_pose.json
```

Important limitation: this is a single-frame, ego-coordinate subset. The current
platform does not persist true ego pose or global trajectories, so
`sample_annotation.translation` is in AAP ego/ISO coordinates, and each
`ego_pose` row is an identity placeholder with an `_aap_note`.

This package can feed single-frame 3D detection preprocessing. It is not a full
nuScenes devkit tracking or multi-frame global evaluation export. Full global
trajectory export depends on the v0.15.0 ego-pose data model.

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
aap_json, kitti, nuscenes, pointmask
```

The name `kitti` is shared with video projects, but the serializers are separate:

| Project data type | `kitti` meaning           |
| ----------------- | ------------------------- |
| `video`           | KITTI tracking 2D labels  |
| `lidar`           | KITTI 3D detection labels |
