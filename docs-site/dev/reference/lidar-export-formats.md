---
audience: [developer, ml_engineer]
type: reference
since: v0.14.7
status: stable
last_reviewed: 2026-08-25
---

# LiDAR Export Formats

LiDAR projects expose three trusted targets. The `nuscenes` identifier remains
reserved for compatibility, but strict preflight rejects it until the complete
scene/time/pose contract exists.

| Target      | Purpose                       | Coordinate frame        |
| ----------- | ----------------------------- | ----------------------- |
| `aap_json`  | Platform-native lossless JSON | API `axis_frame` option |
| `kitti`     | KITTI 3D detection labels     | Selected KITTI camera   |
| `pointmask` | Per-point semantic labels     | Point index order       |

These targets are pure serializers. AAP JSON preserves SceneTrack camera members,
their visibility, and the calibration revision relationship by camera role.

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
export_report.json
```

Each `label_2` line has 15 KITTI fields:

```text
type truncated occluded alpha x1 y1 x2 y2 h w l x y z ry
```

The request body must provide
`{"lidar":{"kitti_camera_role":"camera_front"}}`. Preflight checks every task
for a primary LiDAR item, a trusted dataset `axis_convention`, the selected
camera item, finite row-major calibration matrices, and positive image width and
height. A failed check returns HTTP 409 before an `AsyncJob` is created. The
worker repeats the same check before cache lookup and packaging.

AAP stores `box_3d` PSR in ISO coordinates: +X forward, +Y left, +Z up. For each
frame, the serializer maps ISO corners back through that dataset's `R_norm^T`,
then applies the selected camera's `extrinsic`, optional `rect`, and `intrinsic`.
The 2D bbox uses all eight corners plus edge intersections with the near plane.
It is clipped to the real image bounds, and `truncated` is the lost projected
area ratio. `location` is the 3D box bottom center in rectified camera
coordinates; `rotation_y` comes from the transformed local +X direction and
`alpha = rotation_y - atan2(x, z)`.

If the selected camera has an active manual bbox member for the same SceneTrack,
that bbox takes precedence over the derived 2D projection. The 3D dimensions,
location, and rotation still come from the 3D member. Without a manual member,
the serializer keeps the derived projection path. `export_report.json` records
`manual_bbox_count` and `derived_bbox_count` so downstream consumers can audit
the source of every 2D box. Manual member visibility maps to KITTI occlusion;
truncation stays tied to the image boundary.

Objects fully behind the camera, outside the image, or projection-degenerate are
omitted from `label_2` and listed with a stable reason in `export_report.json`.
The calibration file always contains the selected camera's real `P2`,
`R0_rect`, and `Tr_velo_to_cam`. No identity fallback or `.unverified` filename
exists.

## nuScenes JSON

`nuscenes` is not a trusted export target yet. Project preflight, batch preflight,
direct export requests, and worker-side checks return
`nuscenes_export_not_trusted`. The serializer facade raises the same reason and
cannot produce tables. Re-enabling this target requires real scene tokens,
timestamps, ego poses, calibration rotations, and reference-integrity tests.

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

The registry still recognizes these LiDAR identifiers:

```text
aap_json, kitti, nuscenes, pointmask
```

`nuscenes` recognition does not imply readiness; strict LiDAR preflight always
rejects it. KITTI additionally requires `lidar.kitti_camera_role`.

The name `kitti` is shared with video projects, but the serializers are separate:

| Project data type | `kitti` meaning           |
| ----------------- | ------------------------- |
| `video`           | KITTI tracking 2D labels  |
| `lidar`           | KITTI 3D detection labels |
