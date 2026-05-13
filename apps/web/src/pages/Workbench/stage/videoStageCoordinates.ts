import { clamp01 } from "./videoStageGeometry";

export type VideoPoint = { x: number; y: number };

type CoordinateAdapter = {
  clientToSvg?: (point: VideoPoint) => VideoPoint | null;
  svgToClient?: (point: VideoPoint) => VideoPoint | null;
};

function clientToSvgWithDom(svg: SVGSVGElement, point: VideoPoint): VideoPoint | null {
  const ctm = svg.getScreenCTM?.();
  if (!ctm) return null;
  const inverse = ctm.inverse();
  const svgPoint = svg.createSVGPoint();
  svgPoint.x = point.x;
  svgPoint.y = point.y;
  const transformed = svgPoint.matrixTransform(inverse);
  return { x: transformed.x, y: transformed.y };
}

function svgToClientWithDom(svg: SVGSVGElement, point: VideoPoint): VideoPoint | null {
  const ctm = svg.getScreenCTM?.();
  if (!ctm) return null;
  const svgPoint = svg.createSVGPoint();
  svgPoint.x = point.x;
  svgPoint.y = point.y;
  const transformed = svgPoint.matrixTransform(ctm);
  return { x: transformed.x, y: transformed.y };
}

function clientToSvgWithRect(svg: SVGSVGElement, point: VideoPoint, viewBoxHeight: number): VideoPoint {
  const rect = svg.getBoundingClientRect();
  return {
    x: rect.width > 0 ? (point.x - rect.left) / rect.width : 0,
    y: rect.height > 0 ? ((point.y - rect.top) / rect.height) * viewBoxHeight : 0,
  };
}

function svgToClientWithRect(svg: SVGSVGElement, point: VideoPoint, viewBoxHeight: number): VideoPoint {
  const rect = svg.getBoundingClientRect();
  return {
    x: rect.left + point.x * rect.width,
    y: rect.top + (viewBoxHeight > 0 ? point.y / viewBoxHeight : 0) * rect.height,
  };
}

export function clientPointToVideoPoint(
  svg: SVGSVGElement,
  point: VideoPoint,
  viewBoxHeight: number,
  adapter: CoordinateAdapter = {},
): VideoPoint {
  const svgPoint = adapter.clientToSvg?.(point) ?? clientToSvgWithDom(svg, point) ?? clientToSvgWithRect(svg, point, viewBoxHeight);
  return {
    x: clamp01(svgPoint.x),
    y: clamp01(viewBoxHeight > 0 ? svgPoint.y / viewBoxHeight : 0),
  };
}

export function videoPointToClientPoint(
  svg: SVGSVGElement,
  point: VideoPoint,
  viewBoxHeight: number,
  adapter: CoordinateAdapter = {},
): VideoPoint {
  const svgPoint = {
    x: point.x,
    y: point.y * viewBoxHeight,
  };
  return adapter.svgToClient?.(svgPoint) ?? svgToClientWithDom(svg, svgPoint) ?? svgToClientWithRect(svg, svgPoint, viewBoxHeight);
}
