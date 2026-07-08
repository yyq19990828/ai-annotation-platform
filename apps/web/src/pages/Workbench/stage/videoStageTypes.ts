import type {
  AnnotationResponse,
  VideoBboxGeometry,
  VideoTrackGeometry,
  VideoTrackKeyframe,
  VideoTrackOutsideRange,
} from "@/types";

export type VideoStageGeom = { x: number; y: number; w: number; h: number };
/** 归一化视频坐标点 [0,1]。命中/几何纯函数复用。 */
export type VideoPoint = { x: number; y: number };
export type VideoStageGeometry = VideoBboxGeometry | VideoTrackGeometry;
export type VideoBboxAnnotation = AnnotationResponse & { geometry: VideoBboxGeometry };
export type VideoTrackAnnotation = AnnotationResponse & { geometry: VideoTrackGeometry };
export type VideoResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export type VideoFrameEntry = {
  id: string;
  ann: AnnotationResponse;
  geom: VideoStageGeom;
  className: string;
  source: "manual" | "prediction" | "interpolated" | "legacy";
  occluded?: boolean;
  trackId?: string;
};

export type VideoTrackGhost = VideoFrameEntry & {
  ann: VideoTrackAnnotation;
  source: "manual";
  trackId: string;
  originFrame: number;
};

export type VideoTrackPreview = {
  id: string;
  trackId: string;
  className: string;
  keyframes: VideoTrackKeyframe[];
  outside?: VideoTrackOutsideRange[];
  selected: boolean;
};

export type VideoDragState =
  | { kind: "draw"; start: { x: number; y: number }; current: { x: number; y: number } }
  | { kind: "move"; id: string; start: { x: number; y: number }; origin: VideoStageGeom; current: VideoStageGeom }
  | { kind: "resize"; id: string; dir: VideoResizeDirection; start: { x: number; y: number }; origin: VideoStageGeom; current: VideoStageGeom }
  // 单帧 polygon/polyline 提交后编辑: 拖单个顶点 / 整体平移。points 归一化 [0,1]。
  | { kind: "polyVertex"; id: string; vidx: number; start: { x: number; y: number }; origin: [number, number][]; current: [number, number][] }
  | { kind: "polyMove"; id: string; start: { x: number; y: number }; origin: [number, number][]; current: [number, number][] }
  // v0.21.23 · 交互式 SAM 提示 (smart-point / smart-box)。point 是零位移「拖拽」,
  // bbox 拖出提示框; 松手派发到 onSamPrompt, 不直接建标注。坐标归一化 [0,1]。
  | { kind: "samProbe"; mode: "point" | "bbox"; start: { x: number; y: number }; current: { x: number; y: number }; alt: boolean }
  | { kind: "pan"; sx: number; sy: number }
  | null;

export type VideoTrackConversionOptions = {
  operation: "copy" | "split";
  scope: "frame" | "track";
  frameIndex?: number;
  frameMode?: "keyframes" | "all_frames";
};

export type VideoTrackCompositionOptions = {
  operation: "aggregate_bboxes" | "split_track" | "merge_tracks" | "join_tracks";
  annotationIds: string[];
  frameIndex?: number;
  deleteSources?: boolean;
  // v0.10.30 · 2.5 join 的 gap 填充模式 (interpolate / outside)。
  gapMode?: "interpolate" | "outside";
};

export type VideoTrackKeyframePatch = Partial<VideoTrackKeyframe>;
