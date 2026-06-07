export interface ScreenPoint {
  x: number;
  y: number;
}

const EPS = 1e-9;

function pointOnSegment(point: ScreenPoint, a: ScreenPoint, b: ScreenPoint): boolean {
  const cross = (point.y - a.y) * (b.x - a.x) - (point.x - a.x) * (b.y - a.y);
  if (Math.abs(cross) > EPS) return false;
  const dot = (point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y);
  if (dot < -EPS) return false;
  const lenSq = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  return dot - lenSq <= EPS;
}

export function isPointInPolygon(point: ScreenPoint, polygon: readonly ScreenPoint[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[j];
    const b = polygon[i];
    if (pointOnSegment(point, a, b)) return true;
    const crosses = (a.y > point.y) !== (b.y > point.y);
    if (!crosses) continue;
    const xAtY = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (point.x < xAtY) inside = !inside;
  }
  return inside;
}

export function rectToPolygon(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): ScreenPoint[] {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}
