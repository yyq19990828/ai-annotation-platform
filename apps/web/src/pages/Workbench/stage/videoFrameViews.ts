import type { AnnotationResponse } from "@/types";
import type { DiffMode } from "../modes/types";
import { classColor, getTrackColor } from "./colors";
import {
  deriveTrackNumber,
  isVideoBbox,
  isVideoTrack,
  resolveTrackAtFrame,
  trackReferenceAtFrame,
} from "./videoStageGeometry";
import { isFrameOutside } from "./videoTrackOutside";
import { buildTrackLabelText, shouldShowLabel, type AnnotationVisualConfig } from "./annotationVisual";
import type { VideoStageGeom } from "./videoStageTypes";

/**
 * v0.16.2 · 视频标注层的渲染派生(纯函数,栈无关)。
 *
 * 把「当前帧应显示哪些框 / 轨迹预览 / ghost / 标签」从 VideoStage 的内联 useMemo 抽出,
 * 供新 Konva 栈(VideoKonvaTracksLayer/OverlayLayer)消费。逻辑与 VideoStage + VideoFrameOverlay
 * 现状逐项对齐(epic §6 接受的「双 draw 路径」中 Konva 那条;v0.16.5 删旧栈后单路径)。
 *
 * **不含颜色→hex 转换 / scale 抵消**(那是各 Konva 层在 render 时按 DOM/缩放做的),返回的
 * `color` 是原始 CSS 色串、`geom`/`points` 是归一化坐标,保持本模块纯净可测。
 */

export type VideoEntryView = {
  key: string;
  id: string;
  geom: VideoStageGeom;
  /** 原始 CSS 色(轨迹色 / 类别色);Konva 层 render 时转 hex。 */
  color: string;
  selected: boolean;
  /** 插值帧或遮挡 → 虚线。 */
  dashed: boolean;
  occluded: boolean;
  labelText: string;
  /** 类别名(供 QC 密度/重叠率计算消费)。 */
  className: string;
};

export type VideoPreviewPoint = { frame: number; x: number; y: number; occluded: boolean };

export type VideoTrackPreviewView = {
  id: string;
  color: string;
  selected: boolean;
  /** 可见(非 outside)关键帧中心点,归一化;>1 点画预览线,选中时画关键帧圆点。 */
  points: VideoPreviewPoint[];
};

export type VideoGhostView = {
  id: string;
  geom: VideoStageGeom;
  color: string;
  labelText: string;
};

export type VideoLabelView = {
  key: string;
  geom: VideoStageGeom;
  color: string;
  text: string;
  opacity?: number;
};

export interface VideoFrameViews {
  entries: VideoEntryView[];
  previews: VideoTrackPreviewView[];
  ghost: VideoGhostView | null;
  labels: VideoLabelView[];
}

export interface DeriveVideoFrameViewsInput {
  annotations: AnnotationResponse[];
  frameIndex: number;
  selectedId: string | null;
  hiddenTrackIds?: Set<string>;
  /** 已锁定轨迹:锁定后不再显示参考框(视为已确认,不需逐帧提示)。 */
  lockedTrackIds?: Set<string>;
  reviewDisplayMode?: DiffMode;
  trackColorOverrides?: Record<string, string>;
  visual: AnnotationVisualConfig;
  /** 参考框运动预测开关(实验);开启时参考框恒速外推到当前帧而非取最近关键帧。 */
  predictReference?: boolean;
  /** pending 草稿(画一半 / 待确认);仅当前帧透传。 */
  pendingDraft?: { geom: VideoStageGeom; className: string } | null;
}

const EMPTY_SET = new Set<string>();

/** 复审显示模式过滤(与 VideoStage.visibleInReviewMode 逐位一致)。 */
function visibleInReviewMode(source: string, mode?: DiffMode): boolean {
  if (!mode || mode === "diff") return true;
  if (mode === "raw") return source === "prediction" || source === "interpolated";
  return source === "manual" || source === "legacy";
}

export function deriveVideoFrameViews(input: DeriveVideoFrameViewsInput): VideoFrameViews {
  const {
    annotations,
    frameIndex,
    selectedId,
    hiddenTrackIds = EMPTY_SET,
    lockedTrackIds = EMPTY_SET,
    reviewDisplayMode,
    trackColorOverrides,
    visual,
    predictReference = false,
    pendingDraft,
  } = input;

  const videoTracks = annotations.filter(isVideoTrack);
  const trackNumbers = deriveTrackNumber(videoTracks);
  const trackContent = visual.labelContent.track;

  // 当前帧应显示的 bbox(legacy bbox + track 解析帧)。
  const entries: VideoEntryView[] = [];
  const currentFrameTrackIds = new Set<string>();
  for (const ann of annotations) {
    if (isVideoBbox(ann) && ann.geometry.frame_index === frameIndex) {
      if (!visibleInReviewMode("legacy", reviewDisplayMode)) continue;
      entries.push(buildEntryView(ann, ann.geometry, "legacy", false, undefined, selectedId, trackNumbers, trackColorOverrides, trackContent));
    } else if (isVideoTrack(ann) && !hiddenTrackIds.has(ann.geometry.track_id)) {
      const resolved = resolveTrackAtFrame(ann.geometry, frameIndex);
      if (!resolved || !visibleInReviewMode(resolved.source, reviewDisplayMode)) continue;
      currentFrameTrackIds.add(ann.geometry.track_id);
      entries.push(buildEntryView(ann, resolved.geom, resolved.source, Boolean(resolved.occluded), ann.geometry.track_id, selectedId, trackNumbers, trackColorOverrides, trackContent));
    }
  }

  // 轨迹预览线 + 关键帧圆点:可见且当前帧有解析帧的 track。
  const previews: VideoTrackPreviewView[] = videoTracks
    .filter((ann) => !hiddenTrackIds.has(ann.geometry.track_id) && currentFrameTrackIds.has(ann.geometry.track_id))
    .map((ann) => {
      const previewTrack = {
        type: "video_track_bbox" as const,
        track_id: ann.geometry.track_id,
        keyframes: ann.geometry.keyframes,
        outside: ann.geometry.outside,
      };
      const points: VideoPreviewPoint[] = [...ann.geometry.keyframes]
        .filter((kf) => !isFrameOutside(previewTrack, kf.frame_index))
        .sort((a, b) => a.frame_index - b.frame_index)
        .map((kf) => ({
          frame: kf.frame_index,
          x: kf.bbox.x + kf.bbox.w / 2,
          y: kf.bbox.y + kf.bbox.h / 2,
          occluded: Boolean(kf.occluded),
        }));
      return {
        id: ann.id,
        color: getTrackColor(ann.geometry.track_id, ann.class_name, trackColorOverrides),
        selected: ann.id === selectedId,
        points,
      };
    });

  // ghost:选中轨迹当前帧无框时,画参考框(与 VideoTrackSidebar.selectedTrackGhost 一致)。
  // 锁定轨迹视为已确认,不再逐帧提示参考框。
  let ghost: VideoGhostView | null = null;
  const selectedTrack = videoTracks.find((ann) => ann.id === selectedId) ?? null;
  if (
    selectedTrack
    && !hiddenTrackIds.has(selectedTrack.geometry.track_id)
    && !lockedTrackIds.has(selectedTrack.geometry.track_id)
    && visibleInReviewMode("manual", reviewDisplayMode)
    && !entries.some((e) => e.id === selectedTrack.id)
  ) {
    const reference = trackReferenceAtFrame(selectedTrack.geometry, frameIndex, predictReference);
    if (reference) {
      const num = trackNumbers.get(selectedTrack.id);
      const refLabel = reference.predicted ? `预测 F${reference.originFrame}↗` : `参考 F${reference.originFrame}`;
      ghost = {
        id: selectedTrack.id,
        geom: reference.bbox,
        color: getTrackColor(selectedTrack.geometry.track_id, selectedTrack.class_name, trackColorOverrides),
        labelText: `${num !== undefined ? `#${num} · ` : ""}${selectedTrack.class_name} · ${refLabel}`,
      };
    }
  }

  // 标签门控(always / selected / none);草稿与 ghost 按 selected=true 门控。
  const visibility = visual.labelVisibility;
  const labels: VideoLabelView[] = [];
  for (const entry of entries) {
    if (shouldShowLabel(entry.selected, visibility)) {
      labels.push({ key: `entry-${entry.key}`, geom: entry.geom, color: entry.color, text: entry.labelText });
    }
  }
  if (pendingDraft && shouldShowLabel(true, visibility)) {
    labels.push({ key: "pending-draft", geom: pendingDraft.geom, color: classColor(pendingDraft.className), text: pendingDraft.className, opacity: 0.9 });
  }
  if (ghost && shouldShowLabel(true, visibility)) {
    labels.push({ key: `ghost-${ghost.id}`, geom: ghost.geom, color: ghost.color, text: ghost.labelText, opacity: 0.86 });
  }

  return { entries, previews, ghost, labels };
}

function buildEntryView(
  ann: AnnotationResponse,
  geom: VideoStageGeom,
  source: "manual" | "prediction" | "interpolated" | "legacy",
  occluded: boolean,
  trackId: string | undefined,
  selectedId: string | null,
  trackNumbers: ReadonlyMap<string, number>,
  trackColorOverrides: Record<string, string> | undefined,
  trackContent: AnnotationVisualConfig["labelContent"]["track"],
): VideoEntryView {
  const color = trackId
    ? getTrackColor(trackId, ann.class_name, trackColorOverrides)
    : classColor(ann.class_name);
  const trackNumber = trackNumbers.get(ann.id);
  // 状态后缀（· 由 buildTrackLabelText 拼）；插值 / 遮挡互斥。
  const stateSuffix = source === "interpolated" ? "插值" : occluded ? "遮挡" : undefined;
  return {
    key: `${ann.id}-${trackId ?? "legacy"}`,
    id: ann.id,
    geom,
    color,
    selected: ann.id === selectedId,
    dashed: source === "interpolated" || occluded,
    occluded,
    labelText: buildTrackLabelText(
      {
        className: ann.class_name,
        trackNumber,
        stateSuffix,
        attributes: (ann as { attributes?: Record<string, unknown> | null }).attributes ?? null,
      },
      trackContent,
    ),
    className: ann.class_name,
  };
}
