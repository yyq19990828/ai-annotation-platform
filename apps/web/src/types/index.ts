// ── Role & Status Enums ─────────────────────────────────────────────────────

export type UserRole = "super_admin" | "project_admin" | "reviewer" | "annotator" | "viewer";
export type ProjectStatus = "in_progress" | "completed" | "pending_review" | "archived";
export type TaskStatus = "uploading" | "pending" | "in_progress" | "completed" | "review";

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
  is_labeled: boolean;
  overlap: number;
  total_annotations: number;
  total_predictions: number;
  sequence_order: number | null;
  created_at: string;
  updated_at: string | null;
}

// ── Annotation ──────────────────────────────────────────────────────────────

export interface AIBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  cls: string;
  conf: number;
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
  geometry: { x: number; y: number; w: number; h: number };
  confidence: number | null;
  parent_prediction_id: string | null;
  parent_annotation_id: string | null;
  lead_time: number | null;
  is_active: boolean;
  ground_truth: boolean;
  created_at: string;
  updated_at: string | null;
}

// ── Prediction ──────────────────────────────────────────────────────────────

export interface PredictionShape {
  type: string;
  class_name: string;
  geometry: { x: number; y: number; w: number; h: number };
  confidence: number;
}

export interface PredictionResponse {
  id: string;
  task_id: string;
  project_id: string;
  ml_backend_id: string | null;
  model_version: string | null;
  score: number | null;
  result: PredictionShape[];
  cluster: number | null;
  created_at: string;
}

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
  | "users"
  | "datasets"
  | "storage"
  | "ai-pre"
  | "model-market"
  | "training"
  | "audit"
  | "settings";
