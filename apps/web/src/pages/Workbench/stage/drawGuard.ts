/**
 * 会话级落框守卫：用户拖出一个新框、提交入库前的三道闸（纯函数，便于单测）。
 *  ② 越界 → clamp 回 [0,1]（拖到画布外时坐标可能溢出）
 *  ① 过小（任一边 < 0.005）→ 拒绝并提示「框太小未保存」
 *  ③ 与任一已有框 IoU > 0.95（几乎完全重叠）→ 拒绝并提示「疑似重复」
 *
 * 返回净化后的 geom；任一闸拦截时返回 null（并已 push 对应 toast）。
 */
import { iouShape, type ShapeForIoU } from "./iou";

export type Geom = { x: number; y: number; w: number; h: number };

interface ToastInput {
  msg: string;
  sub?: string;
  kind?: "success" | "warning" | "error" | "";
}

/** 框最小归一化边长（与 resize 提交闸一致）。 */
export const MIN_BOX_SIZE = 0.005;
/** 视为「疑似重复」的 IoU 阈值（完全相同框）。 */
export const DUP_IOU = 0.95;

export function guardDrawnBox(
  geo: Geom,
  existing: ReadonlyArray<ShapeForIoU>,
  pushToast: (toast: ToastInput) => void,
): Geom | null {
  // ② 越界 clamp：先夹住左上角，再约束宽高不越右/下边界。
  const x = Math.max(0, Math.min(1, geo.x));
  const y = Math.max(0, Math.min(1, geo.y));
  const w = Math.min(1 - x, geo.w);
  const h = Math.min(1 - y, geo.h);

  // ① 过小
  if (w < MIN_BOX_SIZE || h < MIN_BOX_SIZE) {
    pushToast({ msg: "框太小未保存", sub: "拖动到至少 0.5% × 0.5%", kind: "error" });
    return null;
  }

  // ③ 疑似重复（类别无关：几何上几乎完全重叠几乎都是误画）
  const g = { x, y, w, h };
  if (existing.some((u) => iouShape(u, g) > DUP_IOU)) {
    pushToast({ msg: "疑似重复，未保存", sub: "与已有框几乎完全重叠", kind: "warning" });
    return null;
  }

  return g;
}
