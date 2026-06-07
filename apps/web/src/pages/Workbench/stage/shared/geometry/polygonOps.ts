import polygonClipping, { type MultiPolygon, type Polygon, type Ring } from "polygon-clipping";
import type { AnnotationResponse, Geometry, MultiPolygonGeometry, PolygonGeometry } from "@/types";
import type { AnnotationPayload } from "@/api/tasks";

type JoinGeometry = PolygonGeometry | MultiPolygonGeometry;

export interface PolygonJoinInput {
  id: string;
  class_name: string;
  annotation_type?: string;
  tool_unit_id?: string | null;
  geometry: Geometry;
  attributes?: Record<string, unknown>;
}

export interface PolygonJoinPayloadResult {
  payload: AnnotationPayload;
  sourceAnnotations: PolygonJoinInput[];
}

function pointsToRing(points: readonly [number, number][]): Ring | null {
  if (points.length < 3) return null;
  const ring: Ring = points.map(([x, y]) => [x, y]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([first[0], first[1]]);
  }
  return ring;
}

function geometryToMultiPolygon(geometry: Geometry): MultiPolygon | null {
  if (geometry.type === "polygon") {
    const outer = pointsToRing(geometry.points);
    if (!outer) return null;
    const holes = (geometry.holes ?? [])
      .map(pointsToRing)
      .filter((ring): ring is Ring => !!ring);
    return [[outer, ...holes]];
  }
  if (geometry.type === "multi_polygon") {
    const polygons: Polygon[] = [];
    for (const polygon of geometry.polygons) {
      const outer = pointsToRing(polygon.points);
      if (!outer) continue;
      const holes = (polygon.holes ?? [])
        .map(pointsToRing)
        .filter((ring): ring is Ring => !!ring);
      polygons.push([outer, ...holes]);
    }
    return polygons.length > 0 ? polygons : null;
  }
  return null;
}

function stripClosingPoint(ring: Ring): [number, number][] {
  const points = ring.map(([x, y]) => [x, y] as [number, number]);
  if (points.length > 1) {
    const first = points[0];
    const last = points[points.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) points.pop();
  }
  return points;
}

function multiPolygonToGeometry(multiPolygon: MultiPolygon): JoinGeometry | null {
  const polygons: PolygonGeometry[] = [];
  for (const polygon of multiPolygon) {
    if (polygon.length === 0) continue;
    const points = stripClosingPoint(polygon[0]);
    if (points.length < 3) continue;
    const holes = polygon.slice(1)
      .map(stripClosingPoint)
      .filter((ring) => ring.length >= 3);
    polygons.push({
      type: "polygon",
      points,
      ...(holes.length > 0 ? { holes } : {}),
    });
  }
  if (polygons.length === 0) return null;
  if (polygons.length === 1) return polygons[0];
  return { type: "multi_polygon", polygons };
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
}

function sharedAttributes(inputs: readonly PolygonJoinInput[]): Record<string, unknown> | undefined {
  const first = inputs[0]?.attributes ?? {};
  if (!inputs.every((input) => sameJson(input.attributes ?? {}, first))) return {};
  return { ...first };
}

export function canJoinPolygonAnnotation(annotation: Pick<AnnotationResponse, "geometry" | "is_locked">): boolean {
  return !annotation.is_locked
    && (annotation.geometry.type === "polygon" || annotation.geometry.type === "multi_polygon");
}

export function joinPolygonGeometries(geometries: readonly Geometry[]): JoinGeometry | null {
  const parts = geometries
    .map(geometryToMultiPolygon)
    .filter((part): part is MultiPolygon => !!part);
  if (parts.length < 2) return null;
  try {
    const [first, ...rest] = parts;
    const result = polygonClipping.union(first, ...rest);
    return multiPolygonToGeometry(result);
  } catch {
    return null;
  }
}

export function buildPolygonJoinPayload(inputs: readonly PolygonJoinInput[]): PolygonJoinPayloadResult | null {
  const sources = inputs.filter((input) =>
    input.geometry.type === "polygon" || input.geometry.type === "multi_polygon",
  );
  if (sources.length < 2) return null;
  const firstClass = sources[0].class_name;
  if (!sources.every((input) => input.class_name === firstClass)) return null;
  const geometry = joinPolygonGeometries(sources.map((input) => input.geometry));
  if (!geometry) return null;
  const payload: AnnotationPayload = {
    annotation_type: geometry.type,
    tool_unit_id: sources[0].tool_unit_id ?? "region",
    class_name: firstClass,
    geometry,
    confidence: 1,
    attributes: sharedAttributes(sources),
  };
  return { payload, sourceAnnotations: sources };
}
