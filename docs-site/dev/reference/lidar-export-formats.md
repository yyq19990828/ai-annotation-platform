---
audience: [developer, ml_engineer]
type: reference
since: v0.14.7
status: stable
last_reviewed: 2026-08-27
---

# LiDAR Export Formats

LiDAR projects expose five trusted targets. nuScenes uses a stricter source
contract than the other targets and only accepts complete scenes imported from
real nuScenes tables and media.

| Target             | Purpose                                | Coordinate frame        |
| ------------------ | -------------------------------------- | ----------------------- |
| `aap_json`         | Platform-native lossless JSON          | API `axis_frame` option |
| `coco-multicamera` | Merged manual camera bbox COCO dataset | Image pixels            |
| `kitti`            | KITTI 3D detection labels              | Selected KITTI camera   |
| `nuscenes`         | nuScenes keyframe table set            | Global nuScenes frame   |
| `pointmask`        | Per-point semantic labels              | Point index order       |

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

## Multi-camera COCO

`coco-multicamera` writes one COCO Instances `annotations.json` for every linked
camera role in the selected project or batch. It exports only active persistent
manual camera bbox members. It never derives a missing 2D label from a 3D box,
and linked images without manual members remain in `images[]` as negative
samples.

Each `file_name` is
`images/{sensor_role}/{task_uuid}/{source_basename}`. Standard COCO consumers can
ignore the additional task, dataset item, sensor role, Scene, frame, SceneTrack,
track, visibility, and calibration relation fields. IDs are deterministic
JavaScript-safe integers derived from stable identities, with collision checks.
When calibration has changed since a member was saved, the annotation remains
valid 2D truth and reports `relation_status=stale`.

The package also contains `media_manifest.json`, `fetch_media.py`,
`export_report.json`, and a README. The worker streams every image to calculate
its actual size and SHA-256. The fetch script rejects unsafe or duplicate paths,
verifies existing and downloaded files, downloads through a temporary file, and
atomically replaces the destination only after verification.

Preflight requires a non-empty task scope, at least one camera link per task,
unique item-to-role bindings within a task, valid image dimensions and object
size, normalized finite positive bbox geometry, known categories, and a closed
manual member → active 3D member → SceneTrack identity. It checks object storage
size before a job is created. A request is limited to 20,000 linked camera
images, 100,000 manual boxes, 20 GiB total media, and 256 MiB per image.

## nuScenes JSON

`nuscenes` writes the 13 core tables under `v1.0-aap/`, plus
`media_manifest.json`, `fetch_nuscenes_media.py`, and a README. The manifest
references the original `.pcd.bin`, camera images, and map at their exact source
paths; the converted platform PCD is never presented as raw nuScenes media.

Preflight requires a real nuScenes source, importer `--frame ego`, ISO 8855,
the complete `0..nbr_samples-1` scene, closed source sample chains, per-sensor
sample data / calibration / ego-pose references, unchanged calibration digests,
and source assets whose stored size and SHA-256 still match object metadata.
Project and batch exports reject partial scenes before creating an async job.

The serializer rebuilds deterministic tokens and `prev` / `next` chains, uses
the source sample timestamp, transforms ego boxes into the global frame, maps
platform `[length,width,height]` to `[width,length,height]`, and calculates
`num_lidar_pts` from the current ego PCD. After running the fetch script, the
tree is compatible with official nuscenes-devkit load and query operations.
This is a keyframe subset, not an official benchmark split: project categories
are not mapped to the official detection/tracking ontology.

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
aap_json, coco-multicamera, kitti, nuscenes, pointmask
```

nuScenes additionally requires its strict source and complete-scene preflight.
KITTI requires `lidar.kitti_camera_role`.

The name `kitti` is shared with video projects, but the serializers are separate:

| Project data type | `kitti` meaning           |
| ----------------- | ------------------------- |
| `video`           | KITTI tracking 2D labels  |
| `lidar`           | KITTI 3D detection labels |
