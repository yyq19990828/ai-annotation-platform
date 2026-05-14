// v0.10.7.1 M4-δ 后续 · I11 · Mask 编辑器状态层。
//
// 把 v0.10.7 落地的 MaskBuffer / maskToPolygon 算法核组装成一个可由 WorkbenchShell
// 单点接入的 React hook：维护 buffer / 当前模式 (brush|erase) / 笔刷半径 / dirty 标志，
// 并提供 `paintAt`、`commitToPolygon`、`initFromPolygon`、`cancel` 工具。
//
// v0.10.7.1 不包含：Konva 渲染层（MaskCanvasOverlay）、ImageStage maskBrush DragInit
// 派发、ToolDock 按钮、AIPredictionPopover「精修」入口、B/E/Shift+滚轮/Esc/Enter hotkey。
// 这些 UI 集成留到 v0.10.7.2 / v0.11.0；本期只稳状态层 + 单测。
//
// 与 useDirtyTracker 协同（v0.10.6 落地）：mask 编辑的「一笔不入 history、松手前累计
// flush 一次」语义可由 useDirtyTracker.flush 承载；本 hook 暴露 commit 入口由调用方
// 决定何时 flush。

import { useCallback, useRef, useState } from "react";
import { MaskBuffer } from "../stage/shared/geometry/maskBuffer";
import { maskToPolygon } from "../stage/shared/geometry/maskToPolygon";

export type MaskMode = "brush" | "erase";

/** 笔刷半径上下界（像素）。 */
export const MASK_BRUSH_MIN_PX = 1;
export const MASK_BRUSH_MAX_PX = 200;
export const MASK_BRUSH_DEFAULT_PX = 16;

export interface UseMaskEditorOptions {
  /** 离屏 buffer 尺寸（必须与图像像素尺寸一致；调用方按 task 切换）。 */
  width: number;
  height: number;
  /** 初始笔刷半径，默认 16px；自动 clamp 到 [MIN, MAX]。 */
  initialRadius?: number;
}

export interface UseMaskEditorReturn {
  /** 是否处于活跃编辑态。`initFromPolygon` / `beginBlank` 后变 true；`cancel` / `commitToPolygon` 后清空。 */
  active: boolean;
  /** 当前模式：笔刷 / 橡皮。 */
  mode: MaskMode;
  /** 笔刷半径（像素，已 clamp）。 */
  radius: number;
  /** 是否在当前会话中改过 buffer（用于 UI 提示「未保存」与 Enter 是否落地）。 */
  dirty: boolean;
  /** 当前 buffer 引用（调用方只读访问）；非编辑态返回 null。 */
  buffer: MaskBuffer | null;
  /** 从空白 buffer 开始（独立 mask 工具入口）。 */
  beginBlank: () => void;
  /** 从 polygon 顶点初始化（AI 候选精修入口）。 */
  initFromPolygon: (points: ReadonlyArray<readonly [number, number]>) => void;
  /** 在像素坐标 (x, y) 处按当前 mode + radius 画一下；越界静默。 */
  paintAt: (x: number, y: number) => void;
  /** 切换模式。 */
  setMode: (m: MaskMode) => void;
  /** 设置笔刷半径，自动 clamp。 */
  setRadius: (r: number) => void;
  /** 退出编辑态、不落库；buffer 清空。 */
  cancel: () => void;
  /**
   * 收尾：调用 maskToPolygon 转出外环顶点。
   *
   * - 空 mask / 顶点 < 3 → 返回 null，调用方可提示「mask 为空」；
   * - 非 null → 调用方走 submitPolygon 落库；
   * - 调用 commitToPolygon 不会自动退出 active；调用方在拿到 polygon 后自行 cancel。
   */
  commitToPolygon: () => { points: [number, number][]; multipleComponents: boolean } | null;
}

function clampRadius(r: number): number {
  if (!Number.isFinite(r)) return MASK_BRUSH_DEFAULT_PX;
  return Math.max(MASK_BRUSH_MIN_PX, Math.min(MASK_BRUSH_MAX_PX, Math.round(r)));
}

/**
 * v0.10.7.1 mask 编辑器状态 hook。
 *
 * 设计：buffer 用 useRef 持有（避免 paintAt 每笔都 rerender），active / mode /
 * radius / dirty 用 useState 触发 UI；buffer 引用通过 getter 暴露给渲染层。
 */
export function useMaskEditor({ width, height, initialRadius = MASK_BRUSH_DEFAULT_PX }: UseMaskEditorOptions): UseMaskEditorReturn {
  const bufferRef = useRef<MaskBuffer | null>(null);
  const [active, setActive] = useState(false);
  const [mode, setMode] = useState<MaskMode>("brush");
  const [radius, _setRadius] = useState<number>(clampRadius(initialRadius));
  const [dirty, setDirty] = useState(false);
  // 引用计数用 revision 让 mask 写入触发 buffer-getter 的消费者 rerender（如 Konva.Image）
  const [, setRev] = useState(0);
  const bump = useCallback(() => setRev((n) => n + 1), []);

  const setRadius = useCallback((r: number) => {
    _setRadius(clampRadius(r));
  }, []);

  const beginBlank = useCallback(() => {
    bufferRef.current = new MaskBuffer({ width, height });
    setActive(true);
    setDirty(false);
    bump();
  }, [width, height, bump]);

  const initFromPolygon = useCallback((points: ReadonlyArray<readonly [number, number]>) => {
    const b = new MaskBuffer({ width, height });
    b.fromPolygon(points);
    bufferRef.current = b;
    setActive(true);
    setDirty(false);
    bump();
  }, [width, height, bump]);

  const paintAt = useCallback((x: number, y: number) => {
    const b = bufferRef.current;
    if (!b) return;
    if (mode === "erase") b.erase(x, y, radius);
    else b.brush(x, y, radius);
    if (!dirty) setDirty(true);
    bump();
  }, [mode, radius, dirty, bump]);

  const cancel = useCallback(() => {
    bufferRef.current = null;
    setActive(false);
    setDirty(false);
    bump();
  }, [bump]);

  const commitToPolygon = useCallback((): { points: [number, number][]; multipleComponents: boolean } | null => {
    const b = bufferRef.current;
    if (!b) return null;
    const out = maskToPolygon(b);
    if (out.points.length < 3) return null;
    return out;
  }, []);

  return {
    active,
    mode,
    radius,
    dirty,
    buffer: bufferRef.current,
    beginBlank,
    initFromPolygon,
    paintAt,
    setMode,
    setRadius,
    cancel,
    commitToPolygon,
  };
}
