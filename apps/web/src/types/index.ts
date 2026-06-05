// ── Role & Status Enums ─────────────────────────────────────────────────────

export type UserRole = "super_admin" | "project_admin" | "reviewer" | "annotator" | "viewer";
export type ProjectStatus = "in_progress" | "completed" | "pending_review" | "archived";
export type TaskStatus = "uploading" | "pending" | "in_progress" | "rejected" | "completed" | "review";
export type BatchStatus = "draft" | "active" | "annotating" | "reviewing" | "approved" | "rejected" | "archived";

// ── Project ─────────────────────────────────────────────────────────────────

export interface Project {
  id: string;
  displayId: string;
  name: string;
  type: string;
  typeKey: ProjectTypeKey;
  owner: string;
  ownerInitial: string;
  members: number;
  total: number;
  done: number;
  review: number;
  pending: number;
  ai: boolean;
  aiModel: string | null;
  classes: string[];
  updated: string;
  status: ProjectStatus;
  due: string;
}

export type ProjectTypeKey =
  | "image-det"
  | "image-seg"
  | "image-kp"
  | "lidar"
  | "video-mm"
  | "video-track"
  | "mm";

// ── Task ────────────────────────────────────────────────────────────────────

export interface TaskImage {
  id: string;
  name: string;
  tags: string[];
  assignee: string;
  aiBoxes: AIBox[];
}

export interface UserBrief {
  id: string;
  name: string;
  email: string;
  role: string | null;
  avatar_initial: string;
}

export interface TaskResponse {
  id: string;
  project_id: string;
  display_id: string;
  file_name: string;
  file_url: string | null;
  file_type: string;
  tags: string[];
  status: TaskStatus;
  assignee_id: string | null;
  /** v0.7.2 · 责任人可视化（list/get/next 端点 populate） */
  assignee: UserBrief | null;
  reviewer: UserBrief | null;
  is_labeled: boolean;
  overlap: number;
  total_annotations: number;
  total_predictions: number;
  batch_id: string | null;
  sequence_order: number | null;
  image_width: number | null;
  image_height: number | null;
  thumbnail_url: string | null;
  blurhash: string | null;
  video_metadata: VideoMetadata | null;
  // v0.6.5 · 状态机锁定相关
  submitted_at: string | null;
  reviewer_id: string | null;
  reviewer_claimed_at: string | null;
  reviewed_at: string | null;
  reject_reason: string | null;
  // v0.10.16 · reject 结构化枚举（旧任务可能为 null）
  reject_reason_type?: string | null;
  // v0.8.7 F7 · 任务跳过
  skip_reason: string | null;
  skipped_at: string | null;
  reopened_count: number;
  last_reopened_at: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface ReviewClaimResponse {
  task_id: string;
  reviewer_id: string;
  reviewer_claimed_at: string;
  is_self: boolean;
}

export interface VideoMetadata {
  duration_ms: number | null;
  fps: number | null;
  frame_count: number | null;
  width: number | null;
  height: number | null;
  codec: string | null;
  playback_path: string | null;
  playback_codec: string | null;
  playback_error: string | null;
  poster_frame_path: string | null;
  probe_error: string | null;
  poster_error: string | null;
  frame_timetable_frame_count: number | null;
  frame_timetable_error: string | null;
}

export interface TaskVideoManifestResponse {
  task_id: string;
  dataset_item_id?: string | null;
  video_url: string;
  poster_url: string | null;
  metadata: VideoMetadata;
  expires_in: number;
}

export interface VideoFrameTimetableEntry {
  frame_index: number;
  pts_ms: number;
  is_keyframe: boolean;
  pict_type: string | null;
  byte_offset: number | null;
}

export interface TaskVideoFrameTimetableResponse {
  task_id: string;
  fps: number | null;
  frame_count: number | null;
  source: "ffprobe" | "estimated";
  frames: VideoFrameTimetableEntry[];
}

export interface VideoFrameOut {
  frame_index: number;
  width: number;
  format: "webp" | "jpeg";
  status: "pending" | "ready" | "failed";
  url: string | null;
  retry_after: number | null;
  error: string | null;
}

export interface VideoFramePrefetchResponse {
  dataset_item_id: string;
  task_id: string | null;
  frames: VideoFrameOut[];
}

// ── Video chunks (WebCodecs demux, v0.10.46) ────────────────────────────────

export interface VideoChunkDiagnostics {
  source_codec: string | null;
  output_codec: string | null;
  keyframe_aligned: boolean | null;
  start_byte_offset: number | null;
  end_byte_offset: number | null;
  smart_copy_eligible: boolean | null;
  fallback_reason: string | null;
}

export interface VideoChunkOut {
  chunk_id: number;
  start_frame: number;
  end_frame: number;
  status: "pending" | "ready" | "failed";
  url: string | null;
  byte_size: number | null;
  generation_mode: "smart_copy" | "transcode" | null;
  diagnostics: VideoChunkDiagnostics | null;
  retry_after: number | null;
  error: string | null;
}

export interface VideoChunksResponse {
  dataset_item_id: string;
  task_id: string | null;
  chunk_size_frames: number;
  fallback_video_url: string | null;
  chunks: VideoChunkOut[];
}

/** WebCodecs demux 用 sample manifest 条目 (后端 ffprobe -show_packets 提取)。字段对齐 API JSON (snake_case)。 */
export interface VideoChunkSampleEntry {
  frame_index: number;
  pts_ms: number;
  duration_ms: number;
  is_keyframe: boolean;
  size_bytes: number;
  offset_in_chunk: number;
}

export interface VideoChunkSamplesResponse {
  dataset_item_id: string;
  chunk_id: number;
  codec_string: string;
  /** base64 编码的 avcC/hvcC extradata (SPS/PPS)，填入 VideoDecoderConfig.description；旧 chunk 为 null。 */
  description?: string | null;
  width: number;
  height: number;
  samples: VideoChunkSampleEntry[];
}

// ── Annotation ──────────────────────────────────────────────────────────────

/** Discriminated union: 形状自描述。v0.5.3 起新增 polygon, v0.9.14 多连通域升级。后续可扩展 keypoint / mask / cuboid。 */
export type BboxGeometry = { type: "bbox"; x: number; y: number; w: number; h: number };
export type VideoBboxGeometry = {
  type: "video_bbox";
  frame_index: number;
  x: number;
  y: number;
  w: number;
  h: number;
};
export type VideoTrackBbox = { x: number; y: number; w: number; h: number };
export type VideoTrackKeyframe = {
  frame_index: number;
  bbox: VideoTrackBbox;
  source: "manual" | "interpolated" | "prediction";
  occluded?: boolean;
  // v0.10.30 · 2.3 逐帧属性覆盖: 仅承载 schema 中 mutable=true 的键; 为空表示该帧用
  // track 默认值 (annotation.attributes)。
  attributes?: Record<string, unknown> | null;
};
export type VideoTrackOutsideRange = {
  from: number;
  to: number;
  source?: "manual" | "prediction";
};
export type VideoTrackGeometry = {
  type: "video_track_bbox";
  track_id: string;
  // v0.10.30 · 2.1 用户可编辑语义标签 (跨任务 Re-ID 心智), 不参与主键、不强制唯一。
  semantic_label?: string | null;
  keyframes: VideoTrackKeyframe[];
  outside?: VideoTrackOutsideRange[];
};
/**
 * v0.9.14 · holes 字段为可选; 老存量 / 老前端写入仍走仅 points 路径, 默认 undefined 即无
 * hole. 新 prediction (mask 单连通带空洞) 在此填 hole 顶点列表 (内环, 与外环 evenodd
 * 镂空). 编辑工具 PolygonTool 仅支持单环, hole 当前只读渲染 (v0.10.x 客户反馈触发再扩).
 */
export type PolygonGeometry = {
  type: "polygon";
  points: [number, number][];
  holes?: [number, number][][];
};
/**
 * v0.9.14 · 多连通域 polygon 集合 (mask RETR_CCOMP 输出). 每个 polygons[i] 仍是带 hole
 * 的单连通 PolygonGeometry. 后端 to_internal_shape (apps/api/app/services/prediction.py)
 * 在 LS shape value.polygons 时输出本类型; 单连通无 hole 仍走 PolygonGeometry 兼容旧前端.
 */
export type MultiPolygonGeometry = {
  type: "multi_polygon";
  polygons: PolygonGeometry[];
};
/** v0.10.28 · 旋转矩形 (OBB). cx,cy 中心, w,h 边长, angle 顺时针角度 [0,360). 坐标归一化. */
export type RotatedBboxGeometry = {
  type: "rotated_bbox";
  cx: number;
  cy: number;
  w: number;
  h: number;
  angle: number;
};
/** v0.10.28 · 开放折线 (不闭合). points 至少 2 个归一化顶点. */
export type PolylineGeometry = {
  type: "polyline";
  points: [number, number][];
};
/** v0.10.28 · 单个关键点. v 为 COCO 可见性: 0 未标注 / 1 遮挡 / 2 可见. */
export type Keypoint = { x: number; y: number; v: 0 | 1 | 2 };
/** v0.10.28 · 关键点集合. 骨骼拓扑 (节点名/连线) 走类别级 ToolBinding.keypoint_schema. */
export type KeypointGeometry = {
  type: "keypoint";
  points: Keypoint[];
};
export type LidarAxisConvention =
  | "iso_8855"
  | "ros_rep103"
  | "kitti_camera"
  | "opencv_camera"
  | "apollo"
  | "y_forward"
  | "sustechpoints_demo"
  | "raw";
/** v0.13.3 · LiDAR 3D 框. center/size/rotation 各为 3 元组(米 / 长宽高 / 绕各轴弧度);
 * 点云 Z-up, 7-DoF 主要用 yaw=rotation[2](绕 Z)。 */
export type Box3DGeometry = {
  type: "box_3d";
  center: [number, number, number];
  size: [number, number, number];
  rotation: [number, number, number];
  convention_at_create?: LidarAxisConvention | null;
};
/** v0.13.3 · 点云 3D 分割掩码. point_indices 指向点云的非负整数索引(预留, v0.13.5+ 用)。 */
export type PointMaskGeometry = {
  type: "point_mask_3d";
  point_indices: number[];
  convention_at_create?: LidarAxisConvention | null;
  decimate_stride?: number | null;
  source_point_count?: number | null;
};
// v0.13.3 · 引入 3D 工作台,把点云 3D 几何并入手写 union(此前刻意延后,见 v0.13.0 注记)。
// 各 2D 窄化点(transforms.ts geometryToShape / BoxListItem)需对 3D 分支兜底:3D 无 2D
// 投影(投影联动是 v0.13.4),退化为空 shape,2D 画布不画;3D 渲染走 three-d 模块。
export type Geometry =
  | BboxGeometry
  | VideoBboxGeometry
  | VideoTrackGeometry
  | PolygonGeometry
  | MultiPolygonGeometry
  | RotatedBboxGeometry
  | PolylineGeometry
  | KeypointGeometry
  | Box3DGeometry
  | PointMaskGeometry;

export interface AIBox {
  id: string;
  annotation_type?: string;
  geometry?: Geometry;
  /** bounding rect — 对所有形状都填，方便列表/Minimap/IoU 近似/选中浮条锚点。 */
  x: number;
  y: number;
  w: number;
  h: number;
  cls: string;
  conf: number;
  /** polygon 形状时填具体外环顶点（归一化坐标）。bbox 时为 undefined。 */
  polygon?: [number, number][];
  /** v0.10.28 · polyline 形状时填顶点序列（归一化坐标，不闭合）。 */
  polyline?: [number, number][];
  /** v0.9.14 · 单连通带 hole 时填内环顶点（归一化坐标）。仅作只读渲染参考, 不参与编辑路径. */
  holes?: [number, number][][];
  /** v0.9.14 · 多连通域时填全部 polygon (含 holes). 当前前端按主外环渲染降级,
   *  保留全字段供 v0.10.x 镂空渲染升级与多 ring 拆分使用. */
  multiPolygon?: { points: [number, number][]; holes?: [number, number][][] }[];
  /** v0.10.28 · keypoint 形状时填各命名节点 (与 keypoint_schema.nodes 同 index). bbox/polygon 时 undefined. */
  keypoints?: Keypoint[];
}

/**
 * v0.10.28 · 单元级骨骼模板 (COCO 范式). 与后端 KeypointSchema (KeypointNode + edges) 对齐;
 * 后端 ToolBinding.keypoint_schema 就位前, 前端先用此类型贯通配置 UI 与画布渲染.
 *   nodes: 命名节点列表 (顺序即 keypoint index); color 可选 (缺省按 index 取预设色).
 *   edges: 骨骼连线, 每条是 nodes 的两个 index [i, j].
 */
export type KeypointNode = { name: string; color?: string | null };
export type KeypointSchema = { nodes: KeypointNode[]; edges: [number, number][] };

export interface Annotation extends AIBox {
  source: "manual" | "prediction_based";
  parent_prediction_id?: string | null;
  lead_time?: number | null;
  // v0.10.5 M4-β · shape 状态位（I15）。所有可选并回落默认值，AI 候选 / 历史数据兼容。
  z_order?: number;
  is_locked?: boolean;
  is_hidden?: boolean;
  // v0.11.27 · 渲染派生字段：由属性 schema 中标了 style_occluded 的 boolean 属性
  // 为 true 时计算得出（见 transforms.annotationToBox）；驱动虚线+半透视觉。非后端字段。
  occluded?: boolean;
  // I12 · Object Group; 同 task 内 group_id 相同的多框为一组 (Ctrl+G 形成).
  group_id?: number | null;
}

export interface AnnotationResponse {
  id: string;
  task_id: string;
  project_id: string | null;
  user_id: string | null;
  source: string;
  annotation_type: string;
  class_name: string;
  geometry: Geometry;
  confidence: number | null;
  parent_prediction_id: string | null;
  parent_annotation_id: string | null;
  lead_time: number | null;
  is_active: boolean;
  ground_truth: boolean;
  attributes?: Record<string, unknown>;
  // v0.10.5 M4-β · shape 状态位（I15）；后端总是回写，旧记录由迁移默认值兜底。
  z_order?: number;
  is_locked?: boolean;
  is_hidden?: boolean;
  // I12 · Object Group; null 表示未分组.
  group_id?: number | null;
  version?: number;
  created_at: string;
  updated_at: string | null;
}

// ── Prediction ──────────────────────────────────────────────────────────────

// v0.9.11 · PredictionShape / PredictionResponse 切换为 codegen 派生 (api-schema-boundary.md).
// 后端 PredictionShape Pydantic 模型在 apps/api/app/schemas/prediction.py; OpenAPI snapshot
// 经 export_openapi.py + pnpm codegen 生成 src/api/generated/types.gen.ts. 这里 re-export
// 并对 geometry 做窄化 (去掉 dict fallback) — 因为前端消费方 (transforms.ts) 仅处理已知
// shape, 未知 LS 类型 (keypoints 等) 在后端 to_internal_shape 已转空 geometry, 前端遇到时
// 走 generic 渲染路径不需要类型支持.
import type {
  PredictionShape as GeneratedPredictionShape,
  PredictionOut as GeneratedPredictionOut,
} from "@/api/generated/types.gen";

// v0.10.29 · 视频项目级采样配置 (软网格导航). 形状由后端 schema 派生.
export type { VideoSamplingConfig } from "@/api/generated/types.gen";

// v0.13.2 · 点云查看器 manifest (主点云 URL + 各相机图 + 标定). 由后端 schema 派生.
export type {
  TaskPointCloudManifestResponse,
  PointCloudCameraOut,
  SensorCalibration,
} from "@/api/generated/types.gen";

export type PredictionShape = Omit<GeneratedPredictionShape, "geometry"> & {
  geometry: Geometry;
  shape_index?: number;
};

export type PredictionSource = "ml_backend" | "external_import";
export type PredictionSourceValue = PredictionSource | (string & {}) | null;

export type PredictionResponse = Omit<GeneratedPredictionOut, "result" | "source"> & {
  source?: PredictionSourceValue;
  result: PredictionShape[];
};

// ── ML Backend ──────────────────────────────────────────────────────────────

export type MLBackendState = "connected" | "disconnected" | "error" | "predicting";

export interface MLBackendResponse {
  id: string;
  project_id: string;
  name: string;
  url: string;
  state: MLBackendState;
  is_interactive: boolean;
  auth_method: string;
  extra_params: Record<string, unknown>;
  error_message: string | null;
  /** v0.8.6 F2 · 周期健康检查时间戳 */
  last_checked_at?: string | null;
  created_at: string;
  updated_at: string;
}

// ── Task Lock ───────────────────────────────────────────────────────────────

export interface TaskLockResponse {
  task_id: string;
  user_id: string;
  expire_at: string;
  unique_id: string;
}

export interface TaskLockConflictDetail {
  reason?: string;
  message?: string;
  user_id?: string | null;
  expire_at?: string | null;
  locked_by?: UserBrief | null;
}

// ── User ────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  group: string;
  status: "online" | "offline" | "busy";
  tasks: number;
  accuracy: number | null;
  joined: string;
  initial: string;
}

export interface Role {
  key: string;
  desc: string;
  count: number;
  perms: string[];
}

// ── Page ────────────────────────────────────────────────────────────────────

export type PageKey =
  | "dashboard"
  | "annotate"
  | "review"
  | "users"
  | "datasets"
  | "storage"
  | "ai-pre"
  | "model-market"
  | "training"
  | "audit"
  | "bugs"
  | "settings"
  // v0.10.14 · E2 · 项目模板库（project_admin / super_admin）
  | "project-templates"
  // v0.8.4 · 成员绩效（super_admin only）
  | "admin-people"
  // v0.12.3 · 我的绩效（所有角色，自助自视）
  | "my-performance"
  // v0.10.16 · DuckDB 离线分析面板（super_admin only）
  | "admin-analytics"
  // v0.10.58 · 系统健康面板（super_admin only）
  | "admin-health";
