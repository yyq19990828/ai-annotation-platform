import type { Viewport } from "./shared/useViewportTransform";
import { fitToCanvas } from "./shared/viewport/fit";
import { clampScale } from "./shared/viewport/zoom";
import type { VideoIssueViewport } from "./videoStageControls";

type Size = { w: number; h: number };

function validSize(size: Size) {
  return Number.isFinite(size.w) && Number.isFinite(size.h) && size.w > 0 && size.h > 0;
}

export function captureVideoIssueViewport(
  viewport: Viewport,
  container: Size,
  media: Size,
): VideoIssueViewport | null {
  if (!validSize(container) || !validSize(media)) return null;
  const fitted = fitToCanvas(container.w, container.h, media.w, media.h);
  if (!fitted || viewport.scale <= 0) return null;
  const result = {
    center_x: (container.w / 2 - viewport.tx) / viewport.scale / media.w,
    center_y: (container.h / 2 - viewport.ty) / viewport.scale / media.h,
    zoom: viewport.scale / fitted.scale,
  };
  return Object.values(result).every(Number.isFinite) && result.zoom > 0 ? result : null;
}

export function restoreVideoIssueViewport(
  saved: VideoIssueViewport,
  container: Size,
  media: Size,
): { viewport: Viewport; clamped: boolean } | null {
  if (!validSize(container) || !validSize(media)) return null;
  if (!Object.values(saved).every(Number.isFinite) || saved.zoom <= 0) return null;
  const fitted = fitToCanvas(container.w, container.h, media.w, media.h);
  if (!fitted) return null;
  const requestedScale = fitted.scale * saved.zoom;
  const scale = clampScale(requestedScale);
  const viewport = {
    scale,
    tx: container.w / 2 - saved.center_x * media.w * scale,
    ty: container.h / 2 - saved.center_y * media.h * scale,
  };
  return Object.values(viewport).every(Number.isFinite)
    ? { viewport, clamped: scale !== requestedScale }
    : null;
}
