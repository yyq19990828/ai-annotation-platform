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
import type { CocoRle } from "../stage/shared/geometry/maskRle";

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
  /**
   * v0.10.8 · buffer 写入计数。paintAt / brush 都会 ++，渲染层（MaskOverlayLayer）可
   * 把它放进 useEffect 依赖来触发 putImageData 重画；不直接代表 buffer 引用变化。
   */
  revision: number;
  canUndo: boolean;
  canRedo: boolean;
  /** 从空白 buffer 开始（独立 mask 工具入口）。 */
  beginBlank: () => void;
  /** 从 polygon 顶点初始化（AI 候选精修入口）。 */
  initFromPolygon: (points: ReadonlyArray<readonly [number, number]>) => void;
  /** 从视频持久化 RLE 初始化。RLE 尺寸必须与 editor 尺寸一致。 */
  initFromRle: (rle: CocoRle) => void;
  /** 在像素坐标 (x, y) 处按当前 mode + radius 画一下；越界静默。 */
  paintAt: (x: number, y: number) => void;
  /** 一次 pointer stroke 的历史边界。 */
  beginStroke: () => void;
  endStroke: () => void;
  undo: () => void;
  redo: () => void;
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
   *
   * v0.23.5 WS-E (ADR-0052 D5)：返回值新增 lossy / droppedComponents / lossyReason。
   * 调用方必须在落库前检查 `lossy`：若 true, 不可静默提交 (会丢多连通分量 / 孔),
   * 应提示用户「请等待原生 Mask 工作台 (v0.23.7)」并保留编辑态。
   */
  commitToPolygon: () => {
    points: [number, number][];
    multipleComponents: boolean;
    lossy: boolean;
    droppedComponents?: number;
    droppedHoles?: number;
    lossyReason?: string;
  } | null;
  /** 视频路径收尾：保持逐像素 RLE，不做 polygon 矢量化。 */
  commitToRle: () => CocoRle | null;
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
  const strokeBeforeRef = useRef<CocoRle | null>(null);
  const undoRef = useRef<CocoRle[]>([]);
  const redoRef = useRef<CocoRle[]>([]);
  const [active, setActive] = useState(false);
  const [mode, setMode] = useState<MaskMode>("brush");
  const [radius, _setRadius] = useState<number>(clampRadius(initialRadius));
  const [dirty, setDirty] = useState(false);
  // 引用计数用 revision 让 mask 写入触发 buffer-getter 的消费者 rerender（如 Konva.Image）
  const [revision, setRev] = useState(0);
  const [historyRevision, setHistoryRevision] = useState(0);
  void historyRevision;
  const bump = useCallback(() => setRev((n) => n + 1), []);

  const setRadius = useCallback((r: number) => {
    _setRadius(clampRadius(r));
  }, []);

  const beginBlank = useCallback(() => {
    bufferRef.current = new MaskBuffer({ width, height });
    setActive(true);
    setDirty(false);
    undoRef.current = [];
    redoRef.current = [];
    strokeBeforeRef.current = null;
    setHistoryRevision((n) => n + 1);
    bump();
  }, [width, height, bump]);

  const initFromPolygon = useCallback((points: ReadonlyArray<readonly [number, number]>) => {
    const b = new MaskBuffer({ width, height });
    b.fromPolygon(points);
    bufferRef.current = b;
    setActive(true);
    setDirty(false);
    undoRef.current = [];
    redoRef.current = [];
    strokeBeforeRef.current = null;
    setHistoryRevision((n) => n + 1);
    bump();
  }, [width, height, bump]);

  const initFromRle = useCallback((rle: CocoRle) => {
    const [rleHeight, rleWidth] = rle.size;
    if (rleWidth !== width || rleHeight !== height) {
      throw new Error(`mask RLE size ${rleWidth}x${rleHeight} does not match editor ${width}x${height}`);
    }
    bufferRef.current = MaskBuffer.fromRle(rle);
    setActive(true);
    setDirty(false);
    undoRef.current = [];
    redoRef.current = [];
    strokeBeforeRef.current = null;
    setHistoryRevision((n) => n + 1);
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

  const beginStroke = useCallback(() => {
    if (!bufferRef.current || strokeBeforeRef.current) return;
    strokeBeforeRef.current = bufferRef.current.toRle();
  }, []);

  const endStroke = useCallback(() => {
    const before = strokeBeforeRef.current;
    const current = bufferRef.current;
    strokeBeforeRef.current = null;
    if (!before || !current) return;
    const after = current.toRle();
    if (before.counts.length === after.counts.length
      && before.counts.every((count, index) => count === after.counts[index])) return;
    undoRef.current = [...undoRef.current.slice(-19), before];
    redoRef.current = [];
    setHistoryRevision((n) => n + 1);
  }, []);

  const restore = useCallback((rle: CocoRle) => {
    bufferRef.current = MaskBuffer.fromRle(rle);
    setDirty(true);
    bump();
  }, [bump]);

  const undo = useCallback(() => {
    const current = bufferRef.current;
    const previous = undoRef.current.pop();
    if (!current || !previous) return;
    redoRef.current.push(current.toRle());
    restore(previous);
    setHistoryRevision((n) => n + 1);
  }, [restore]);

  const redo = useCallback(() => {
    const current = bufferRef.current;
    const next = redoRef.current.pop();
    if (!current || !next) return;
    undoRef.current.push(current.toRle());
    restore(next);
    setHistoryRevision((n) => n + 1);
  }, [restore]);

  const cancel = useCallback(() => {
    bufferRef.current = null;
    setActive(false);
    setDirty(false);
    undoRef.current = [];
    redoRef.current = [];
    strokeBeforeRef.current = null;
    setHistoryRevision((n) => n + 1);
    bump();
  }, [bump]);

  const commitToPolygon = useCallback((): {
    points: [number, number][];
    multipleComponents: boolean;
    lossy: boolean;
    droppedComponents?: number;
    droppedHoles?: number;
    lossyReason?: string;
  } | null => {
    const b = bufferRef.current;
    if (!b) return null;
    const out = maskToPolygon(b);
    if (out.points.length < 3) return null;
    // v0.23.5 WS-E · 透传 maskToPolygon 的 lossy 诊断字段, 调用方据此决定是否落库。
    return out;
  }, []);

  const commitToRle = useCallback((): CocoRle | null => {
    return bufferRef.current?.toRle() ?? null;
  }, []);

  return {
    active,
    mode,
    radius,
    dirty,
    buffer: bufferRef.current,
    revision,
    canUndo: undoRef.current.length > 0,
    canRedo: redoRef.current.length > 0,
    beginBlank,
    initFromPolygon,
    initFromRle,
    paintAt,
    beginStroke,
    endStroke,
    undo,
    redo,
    setMode,
    setRadius,
    cancel,
    commitToPolygon,
    commitToRle,
  };
}
