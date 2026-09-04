import type { SensorCalibration } from "@/types";

const MATRIX_LENGTHS = {
  intrinsic: 9,
  extrinsic: 16,
  rect: 16,
} as const;

type CalibrationPart = keyof typeof MATRIX_LENGTHS;

export type CalibrationDraftResult =
  | { ok: true; value: SensorCalibration }
  | { ok: false; error: string };

function parseMatrix(
  value: unknown,
  part: CalibrationPart,
  optional = false,
): number[] | null | string {
  if (optional && (value === undefined || value === null)) return null;
  if (!Array.isArray(value)) return `${part} 必须是数组`;
  if (value.length !== MATRIX_LENGTHS[part]) {
    return `${part} 必须包含 ${MATRIX_LENGTHS[part]} 个数字`;
  }
  if (value.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
    return `${part} 只能包含有限数字`;
  }
  return value as number[];
}

export function parseCalibrationDraft(source: string): CalibrationDraftResult {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    return { ok: false, error: "JSON 语法不正确" };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "标定必须是 JSON 对象" };
  }
  const object = raw as Record<string, unknown>;
  const extraKeys = Object.keys(object).filter(
    (key) => key !== "intrinsic" && key !== "extrinsic" && key !== "rect",
  );
  if (extraKeys.length > 0) {
    return { ok: false, error: `不支持的字段：${extraKeys.join("、")}` };
  }
  const intrinsic = parseMatrix(object.intrinsic, "intrinsic");
  if (typeof intrinsic === "string") return { ok: false, error: intrinsic };
  const extrinsic = parseMatrix(object.extrinsic, "extrinsic");
  if (typeof extrinsic === "string") return { ok: false, error: extrinsic };
  const rect = parseMatrix(object.rect, "rect", true);
  if (typeof rect === "string") return { ok: false, error: rect };
  return {
    ok: true,
    value: {
      intrinsic: intrinsic as SensorCalibration["intrinsic"],
      extrinsic: extrinsic as SensorCalibration["extrinsic"],
      rect: rect as SensorCalibration["rect"],
    },
  };
}

export function formatCalibrationDraft(calibration: SensorCalibration): string {
  return JSON.stringify(calibration, null, 2);
}

export function changedCalibrationParts(
  before: SensorCalibration,
  after: SensorCalibration,
): CalibrationPart[] {
  return (Object.keys(MATRIX_LENGTHS) as CalibrationPart[]).filter(
    (part) => JSON.stringify(before[part] ?? null) !== JSON.stringify(after[part] ?? null),
  );
}
