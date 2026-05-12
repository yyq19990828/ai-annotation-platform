import type {
  AnnotationResponse,
  VideoBboxGeometry,
  VideoTrackGeometry,
  VideoTrackKeyframe,
  VideoTrackOutsideRange,
} from "@/types";

export type VideoStageGeom = { x: number; y: number; w: number; h: number };
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
  | null;

export type VideoTrackConversionOptions = {
  operation: "copy" | "split";
  scope: "frame" | "track";
  frameIndex?: number;
  frameMode?: "keyframes" | "all_frames";
};

export type VideoTrackCompositionOptions = {
  operation: "aggregate_bboxes" | "split_track" | "merge_tracks";
  annotationIds: string[];
  frameIndex?: number;
  deleteSources?: boolean;
};

export type VideoTrackKeyframePatch = Partial<VideoTrackKeyframe>;
