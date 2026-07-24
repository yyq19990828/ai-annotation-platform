// v0.10.16 · reject 原因类型枚举与中文 label 映射（前端单点）
// 后端 enum: missing | extra | wrong_label | wrong_geometry

export type RejectReasonType = "missing" | "extra" | "wrong_label" | "wrong_geometry";

export const REJECT_REASON_TYPE_LABELS: Record<RejectReasonType, string> = {
  missing: "漏标",
  extra: "多标",
  wrong_label: "类别错误",
  wrong_geometry: "位置或尺寸不准",
};

export const REJECT_REASON_TYPE_ORDER: RejectReasonType[] = [
  "missing",
  "extra",
  "wrong_label",
  "wrong_geometry",
];
