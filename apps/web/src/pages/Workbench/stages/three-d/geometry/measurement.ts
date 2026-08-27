export const MAX_MEASUREMENT_ANCHORS = 64;
export const MAX_MEASUREMENT_PATHS = 20;

export type MeasurementPosition = [number, number, number];

export interface MeasurementAnchor {
  pointIndex: number;
  position: MeasurementPosition;
}

export interface MeasurementPath {
  id: string;
  anchors: MeasurementAnchor[];
  visible: boolean;
}

export interface MeasurementSummary {
  segmentCount: number;
  distance3d: number;
  horizontalDistance: number;
  elevationChange: number;
}

export function summarizeMeasurement(anchors: readonly MeasurementAnchor[]): MeasurementSummary {
  let distance3d = 0;
  let horizontalDistance = 0;
  for (let index = 1; index < anchors.length; index += 1) {
    const previous = anchors[index - 1].position;
    const current = anchors[index].position;
    const dx = current[0] - previous[0];
    const dy = current[1] - previous[1];
    const dz = current[2] - previous[2];
    horizontalDistance += Math.hypot(dx, dy);
    distance3d += Math.hypot(dx, dy, dz);
  }
  const elevationChange =
    anchors.length >= 2 ? anchors[anchors.length - 1].position[2] - anchors[0].position[2] : 0;
  return {
    segmentCount: Math.max(0, anchors.length - 1),
    distance3d,
    horizontalDistance,
    elevationChange,
  };
}

export function formatMeasurementMeters(value: number, signed = false): string {
  const normalized = Math.abs(value) < 0.0005 ? 0 : value;
  const prefix = signed && normalized > 0 ? "+" : "";
  return `${prefix}${normalized.toFixed(2)} m`;
}
