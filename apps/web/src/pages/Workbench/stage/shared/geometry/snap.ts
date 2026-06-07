import type { AnnotationResponse, MultiPolygonGeometry, PolygonGeometry } from "@/types";
import { projectOnSegment, type Pt } from "../../polygonGeom";

export interface SnapPointCandidate {
  point: Pt;
  annotationId?: string;
  polygonIndex?: number;
  pointIndex?: number;
}

export interface SnapSegmentCandidate {
  a: Pt;
  b: Pt;
  annotationId?: string;
  polygonIndex?: number;
  edgeIndex?: number;
}

export interface SnapMatch {
  point: Pt;
  distancePx: number;
  kind: "point" | "segment";
  annotationId?: string;
  polygonIndex?: number;
  pointIndex?: number;
  edgeIndex?: number;
}

export interface SnapIndex {
  points: SnapPointCandidate[];
  segments: SnapSegmentCandidate[];
}

export interface SnapViewportTransform {
  imgW: number;
  imgH: number;
  scale: number;
}

function distancePx(a: Pt, b: Pt, transform: SnapViewportTransform): number {
  return Math.hypot(
    (a[0] - b[0]) * transform.imgW * transform.scale,
    (a[1] - b[1]) * transform.imgH * transform.scale,
  );
}

function polygonsFromGeometry(geometry: AnnotationResponse["geometry"]): PolygonGeometry[] {
  if (geometry.type === "polygon") return [geometry];
  if (geometry.type === "multi_polygon") return geometry.polygons;
  return [];
}

export function snapPointToCandidates(
  point: Pt,
  candidates: readonly SnapPointCandidate[],
  thresholdPx: number,
  transform: SnapViewportTransform,
): SnapMatch | null {
  let best: SnapMatch | null = null;
  for (const candidate of candidates) {
    const dist = distancePx(point, candidate.point, transform);
    if (dist > thresholdPx) continue;
    if (!best || dist < best.distancePx) {
      best = {
        point: [candidate.point[0], candidate.point[1]],
        distancePx: dist,
        kind: "point",
        annotationId: candidate.annotationId,
        polygonIndex: candidate.polygonIndex,
        pointIndex: candidate.pointIndex,
      };
    }
  }
  return best;
}

export function snapPointToSegments(
  point: Pt,
  segments: readonly SnapSegmentCandidate[],
  thresholdPx: number,
  transform: SnapViewportTransform,
): SnapMatch | null {
  let best: SnapMatch | null = null;
  for (const segment of segments) {
    const projected = projectOnSegment(point, segment.a, segment.b);
    const dist = distancePx(point, projected.proj, transform);
    if (dist > thresholdPx) continue;
    if (!best || dist < best.distancePx) {
      best = {
        point: [projected.proj[0], projected.proj[1]],
        distancePx: dist,
        kind: "segment",
        annotationId: segment.annotationId,
        polygonIndex: segment.polygonIndex,
        edgeIndex: segment.edgeIndex,
      };
    }
  }
  return best;
}

export function buildSnapIndex(annotations: readonly AnnotationResponse[]): SnapIndex {
  const points: SnapPointCandidate[] = [];
  const segments: SnapSegmentCandidate[] = [];

  for (const annotation of annotations) {
    const polygons = polygonsFromGeometry(annotation.geometry);
    polygons.forEach((polygon: PolygonGeometry | MultiPolygonGeometry["polygons"][number], polygonIndex) => {
      const ring = polygon.points;
      if (ring.length < 3) return;
      ring.forEach((point, pointIndex) => {
        points.push({
          point: [point[0], point[1]],
          annotationId: annotation.id,
          polygonIndex,
          pointIndex,
        });
      });
      for (let edgeIndex = 0; edgeIndex < ring.length; edgeIndex++) {
        const a = ring[edgeIndex];
        const b = ring[(edgeIndex + 1) % ring.length];
        segments.push({
          a: [a[0], a[1]],
          b: [b[0], b[1]],
          annotationId: annotation.id,
          polygonIndex,
          edgeIndex,
        });
      }
    });
  }

  return { points, segments };
}
