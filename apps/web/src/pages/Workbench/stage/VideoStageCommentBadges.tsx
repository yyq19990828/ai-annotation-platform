import type { AnnotationResponse } from "@/types";
import {
  AnnotationCommentBadgeTargets,
  buildAnnotationCommentBadgeModels,
  type AnnotationCommentBadgeModel,
} from "./ImageStageCommentBadges";
import type { VideoEntryView } from "./videoFrameViews";

type VideoBadgeBounds = { x: number; y: number; w: number; h: number };

export interface BuildVideoAnnotationCommentBadgesOptions {
  entries: readonly VideoEntryView[];
  maskRecords?: readonly { id: string; geom: VideoBadgeBounds }[];
  annotations?: readonly AnnotationResponse[];
  counts?: Readonly<Record<string, number>>;
  imgW: number;
  imgH: number;
  vp: { scale: number; tx: number; ty: number };
  viewportSize?: { w: number; h: number };
  selectedIds?: ReadonlySet<string>;
}

function keypointBounds(entry: VideoEntryView): VideoBadgeBounds | null {
  const points = entry.keypoints?.filter((point) => point.v > 0) ?? [];
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function buildVideoAnnotationCommentBadges({
  entries,
  maskRecords = [],
  annotations = [],
  counts,
  imgW,
  imgH,
  vp,
  viewportSize,
  selectedIds,
}: BuildVideoAnnotationCommentBadgesOptions): AnnotationCommentBadgeModel[] {
  if (!counts) return [];
  const annotationById = new Map(annotations.map((annotation) => [annotation.id, annotation]));
  const isVisibleAnnotation = (id: string) => {
    const annotation = annotationById.get(id);
    return !annotation || (annotation.is_active && !annotation.is_hidden);
  };
  const anchors = [
    ...entries.flatMap((entry) => {
      if (!isVisibleAnnotation(entry.id)) return [];
      const bounds = entry.keypoints ? keypointBounds(entry) : entry.geom;
      if (!bounds) return [];
      return [{ id: entry.id, count: counts[entry.id] ?? 0, bounds }];
    }),
    ...maskRecords.flatMap((record) => {
      if (!isVisibleAnnotation(record.id)) return [];
      return [{ id: record.id, count: counts[record.id] ?? 0, bounds: record.geom }];
    }),
  ];
  return buildAnnotationCommentBadgeModels({
    anchors,
    imgW,
    imgH,
    vp,
    viewportSize,
    selectedIds,
  });
}

export interface VideoStageCommentBadgesProps extends BuildVideoAnnotationCommentBadgesOptions {
  onOpenAnnotationComments?: (annotationId: string) => void;
  interactive?: boolean;
}

export function VideoStageCommentBadges({
  onOpenAnnotationComments,
  interactive = true,
  ...options
}: VideoStageCommentBadgesProps) {
  const badges = buildVideoAnnotationCommentBadges(options);
  return (
    <AnnotationCommentBadgeTargets
      badges={badges}
      onOpenAnnotationComments={onOpenAnnotationComments}
      interactive={interactive}
    />
  );
}
