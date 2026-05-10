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
  poster_frame_path: string | null;
  probe_error: string | null;
  poster_error: string | null;
}

export interface TaskVideoManifestResponse {
  task_id: string;
  video_url: string;
  poster_url: string | null;
  metadata: VideoMetadata;
  expires_in: number;
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
export type Geometry = BboxGeometry | VideoBboxGeometry | PolygonGeometry | MultiPolygonGeometry;

export interface AIBox {
  id: string;
  /** bounding rect — 对所有形状都填，方便列表/Minimap/IoU 近似/选中浮条锚点。 */
  x: number;
  y: number;
  w: number;
  h: number;
  cls: string;
  conf: number;
  /** polygon 形状时填具体外环顶点（归一化坐标）。bbox 时为 undefined。 */
  polygon?: [number, number][];
  /** v0.9.14 · 单连通带 hole 时填内环顶点（归一化坐标）。仅作只读渲染参考, 不参与编辑路径. */
  holes?: [number, number][][];
  /** v0.9.14 · 多连通域时填全部 polygon (含 holes). 当前前端按主外环渲染降级,
   *  保留全字段供 v0.10.x 镂空渲染升级与多 ring 拆分使用. */
  multiPolygon?: { points: [number, number][]; holes?: [number, number][][] }[];
}

export interface Annotation extends AIBox {
  source: "manual" | "prediction_based";
  parent_prediction_id?: string | null;
  lead_time?: number | null;
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

export type PredictionShape = Omit<GeneratedPredictionShape, "geometry"> & {
  geometry: Geometry;
};

export type PredictionResponse = Omit<GeneratedPredictionOut, "result"> & {
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
  // v0.8.4 · 成员绩效（super_admin only）
  | "admin-people";
