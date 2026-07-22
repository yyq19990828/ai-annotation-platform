// 图片 / 视频共用的 Mask 编辑器状态层：二值 Buffer、pointer tool、operation preview 与 history。

import { useCallback, useRef, useState } from "react";
import { MaskBuffer, type MaskBrushShape } from "../stage/shared/geometry/maskBuffer";
import { maskToPolygon } from "../stage/shared/geometry/maskToPolygon";
import type { CocoRle } from "../stage/shared/geometry/maskRle";
import type {
  MaskConnectivity,
  MaskOperationReport,
  MaskOperationResult,
  MaskOperationSpec,
} from "../stage/shared/geometry/maskOperations";
import { applyMaskOperation } from "../stage/shared/geometry/maskOperations";
import {
  applyMaskInstanceOperation,
  type MaskInstanceOperationPlan,
  type MaskInstanceOperationSpec,
} from "../stage/shared/geometry/maskInstanceOperations";
import {
  executeRasterMaskInstanceOperationAsync,
  executeRasterMaskOperationAsync,
  RasterMaskWorkerCancelledError,
} from "../stage/shared/rasterMaskCompute";
import type { MaskEditorPhase } from "./canEditMask";

export type MaskMode = "brush" | "erase";
export type MaskEditorTool =
  | MaskMode
  | "lasso_add"
  | "lasso_subtract"
  | "fill_add"
  | "fill_subtract"
  | "component_keep"
  | "component_delete"
  | "component_copy"
  | "hole_fill";

export const MASK_BRUSH_MIN_PX = 1;
export const MASK_BRUSH_MAX_PX = 200;
export const MASK_BRUSH_DEFAULT_PX = 16;

export interface MaskOperationPreview {
  id: number;
  name: string;
  sourceRevision: number;
  alpha: Uint8Array;
  report: MaskOperationReport;
}

export interface MaskInstanceOperationPreview {
  id: number;
  name: string;
  sourceRevision: number;
  plan: MaskInstanceOperationPlan;
}

export type MaskOperationStatus = "idle" | "computing" | "preview" | "error";

interface MaskHistoryCommand {
  name: string;
  before: CocoRle;
  after: CocoRle;
  report?: MaskOperationReport;
}

export interface UseMaskEditorOptions {
  width: number;
  height: number;
  initialRadius?: number;
}

export interface UseMaskEditorReturn {
  phase?: MaskEditorPhase;
  active: boolean;
  mode: MaskMode;
  tool: MaskEditorTool;
  brushShape: MaskBrushShape;
  connectivity: MaskConnectivity;
  radius: number;
  dirty: boolean;
  buffer: MaskBuffer | null;
  revision: number;
  canUndo: boolean;
  canRedo: boolean;
  operationPreview: MaskOperationPreview | null;
  instanceOperationPreview: MaskInstanceOperationPreview | null;
  operationStatus: MaskOperationStatus;
  operationError: unknown;
  beginBlank: () => void;
  initFromPolygon: (points: ReadonlyArray<readonly [number, number]>) => void;
  initFromRle: (rle: CocoRle) => void;
  materializeFromRle: (rle: CocoRle) => void;
  paintAt: (x: number, y: number) => void;
  beginStroke: () => void;
  endStroke: () => void;
  undo: () => void;
  redo: () => void;
  setMode: (mode: MaskMode) => void;
  setTool: (tool: MaskEditorTool) => void;
  setBrushShape: (shape: MaskBrushShape) => void;
  setConnectivity: (connectivity: MaskConnectivity) => void;
  setRadius: (radius: number) => void;
  previewOperation: (
    name: string,
    result: MaskOperationResult,
    sourceRevision?: number,
  ) => boolean;
  runOperation: (
    name: string,
    operation: MaskOperationSpec,
    context?: { sessionId: string; generation: number },
  ) => Promise<boolean>;
  previewInstanceOperation: (
    name: string,
    plan: MaskInstanceOperationPlan,
    sourceRevision?: number,
  ) => boolean;
  runInstanceOperation: (
    name: string,
    operation: MaskInstanceOperationSpec,
    context?: { sessionId: string; generation: number },
  ) => Promise<boolean>;
  confirmOperation: () => boolean;
  cancelOperation: () => void;
  cancel: () => void;
  commitToPolygon: () => {
    points: [number, number][];
    multipleComponents: boolean;
    lossy: boolean;
    droppedComponents?: number;
    droppedHoles?: number;
    lossyReason?: string;
  } | null;
  commitToRle: () => CocoRle | null;
}

function clampRadius(radius: number): number {
  if (!Number.isFinite(radius)) return MASK_BRUSH_DEFAULT_PX;
  return Math.max(MASK_BRUSH_MIN_PX, Math.min(MASK_BRUSH_MAX_PX, Math.round(radius)));
}

function equalRle(left: CocoRle, right: CocoRle): boolean {
  return left.size[0] === right.size[0]
    && left.size[1] === right.size[1]
    && left.counts.length === right.counts.length
    && left.counts.every((count, index) => count === right.counts[index]);
}

export function useMaskEditor({
  width,
  height,
  initialRadius = MASK_BRUSH_DEFAULT_PX,
}: UseMaskEditorOptions): UseMaskEditorReturn {
  const bufferRef = useRef<MaskBuffer | null>(null);
  const strokeBeforeRef = useRef<CocoRle | null>(null);
  const undoRef = useRef<MaskHistoryCommand[]>([]);
  const redoRef = useRef<MaskHistoryCommand[]>([]);
  const operationPreviewRef = useRef<MaskOperationPreview | null>(null);
  const instanceOperationPreviewRef = useRef<MaskInstanceOperationPreview | null>(null);
  const operationIdRef = useRef(0);
  const operationAbortRef = useRef<AbortController | null>(null);
  const revisionRef = useRef(0);
  const [active, setActive] = useState(false);
  const [mode, setModeState] = useState<MaskMode>("brush");
  const [tool, setToolState] = useState<MaskEditorTool>("brush");
  const [brushShape, setBrushShape] = useState<MaskBrushShape>("circle");
  const [connectivity, setConnectivity] = useState<MaskConnectivity>(4);
  const [radius, setRadiusState] = useState(clampRadius(initialRadius));
  const [dirty, setDirty] = useState(false);
  const [revision, setRevision] = useState(0);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [operationPreview, setOperationPreview] = useState<MaskOperationPreview | null>(null);
  const [instanceOperationPreview, setInstanceOperationPreview] = useState<MaskInstanceOperationPreview | null>(null);
  const [operationStatus, setOperationStatus] = useState<MaskOperationStatus>("idle");
  const [operationError, setOperationError] = useState<unknown>(undefined);
  void historyRevision;

  const bump = useCallback(() => {
    revisionRef.current += 1;
    setRevision(revisionRef.current);
  }, []);

  const clearOperationPreview = useCallback(() => {
    operationPreviewRef.current = null;
    instanceOperationPreviewRef.current = null;
    setOperationPreview(null);
    setInstanceOperationPreview(null);
    setOperationStatus("idle");
  }, []);

  const cancelActiveOperation = useCallback(() => {
    operationAbortRef.current?.abort();
    operationAbortRef.current = null;
    setOperationError(undefined);
    clearOperationPreview();
  }, [clearOperationPreview]);

  const resetHistory = useCallback(() => {
    undoRef.current = [];
    redoRef.current = [];
    strokeBeforeRef.current = null;
    setHistoryRevision((value) => value + 1);
  }, []);

  const validateRleSize = useCallback((rle: CocoRle) => {
    const [rleHeight, rleWidth] = rle.size;
    if (rleWidth !== width || rleHeight !== height) {
      throw new Error(`mask RLE size ${rleWidth}x${rleHeight} does not match editor ${width}x${height}`);
    }
  }, [height, width]);

  const installBuffer = useCallback((buffer: MaskBuffer, isDirty: boolean) => {
    bufferRef.current = buffer;
    setActive(true);
    setDirty(isDirty);
    resetHistory();
    cancelActiveOperation();
    bump();
  }, [bump, cancelActiveOperation, resetHistory]);

  const beginBlank = useCallback(() => {
    installBuffer(new MaskBuffer({ width, height }), false);
  }, [height, installBuffer, width]);

  const initFromPolygon = useCallback((points: ReadonlyArray<readonly [number, number]>) => {
    const buffer = new MaskBuffer({ width, height });
    buffer.fromPolygon(points);
    installBuffer(buffer, false);
  }, [height, installBuffer, width]);

  const initFromRle = useCallback((rle: CocoRle) => {
    validateRleSize(rle);
    installBuffer(MaskBuffer.fromRle(rle), false);
  }, [installBuffer, validateRleSize]);

  const materializeFromRle = useCallback((rle: CocoRle) => {
    validateRleSize(rle);
    installBuffer(MaskBuffer.fromRle(rle), true);
  }, [installBuffer, validateRleSize]);

  const setRadius = useCallback((nextRadius: number) => {
    setRadiusState(clampRadius(nextRadius));
  }, []);

  const setMode = useCallback((nextMode: MaskMode) => {
    setModeState(nextMode);
    setToolState(nextMode);
    cancelActiveOperation();
  }, [cancelActiveOperation]);

  const setTool = useCallback((nextTool: MaskEditorTool) => {
    setToolState(nextTool);
    if (nextTool === "brush" || nextTool === "erase") setModeState(nextTool);
    cancelActiveOperation();
  }, [cancelActiveOperation]);

  const paintAt = useCallback((x: number, y: number) => {
    const buffer = bufferRef.current;
    if (
      !buffer
      || operationPreviewRef.current
      || instanceOperationPreviewRef.current
      || (tool !== "brush" && tool !== "erase")
    ) return;
    if (mode === "erase") buffer.erase(x, y, radius, brushShape);
    else buffer.brush(x, y, radius, 255, brushShape);
    setDirty(true);
    bump();
  }, [brushShape, bump, mode, radius, tool]);

  const beginStroke = useCallback(() => {
    if (
      !bufferRef.current
      || strokeBeforeRef.current
      || operationPreviewRef.current
      || instanceOperationPreviewRef.current
      || (tool !== "brush" && tool !== "erase")
    ) return;
    strokeBeforeRef.current = bufferRef.current.toRle();
  }, [tool]);

  const endStroke = useCallback(() => {
    const before = strokeBeforeRef.current;
    const current = bufferRef.current;
    strokeBeforeRef.current = null;
    if (!before || !current) return;
    const after = current.toRle();
    if (equalRle(before, after)) return;
    undoRef.current = [...undoRef.current.slice(-19), { name: "stroke", before, after }];
    redoRef.current = [];
    setHistoryRevision((value) => value + 1);
  }, []);

  const restore = useCallback((rle: CocoRle) => {
    bufferRef.current = MaskBuffer.fromRle(rle);
    cancelActiveOperation();
    setDirty(true);
    bump();
  }, [bump, cancelActiveOperation]);

  const undo = useCallback(() => {
    if (operationPreviewRef.current || instanceOperationPreviewRef.current) {
      clearOperationPreview();
      return;
    }
    const command = undoRef.current.pop();
    if (!bufferRef.current || !command) return;
    redoRef.current.push(command);
    restore(command.before);
    setHistoryRevision((value) => value + 1);
  }, [clearOperationPreview, restore]);

  const redo = useCallback(() => {
    const command = redoRef.current.pop();
    if (!bufferRef.current || !command) return;
    undoRef.current.push(command);
    restore(command.after);
    setHistoryRevision((value) => value + 1);
  }, [restore]);

  const previewOperation = useCallback((
    name: string,
    result: MaskOperationResult,
    sourceRevision = revisionRef.current,
  ): boolean => {
    const current = bufferRef.current;
    if (!current || sourceRevision !== revisionRef.current) return false;
    if (result.alpha.length !== current.data.length) {
      throw new Error("mask operation preview dimensions do not match the editor buffer");
    }
    operationIdRef.current += 1;
    const preview: MaskOperationPreview = {
      id: operationIdRef.current,
      name,
      sourceRevision,
      alpha: result.alpha,
      report: result.report,
    };
    operationPreviewRef.current = preview;
    setOperationPreview(preview);
    setOperationError(undefined);
    setOperationStatus("preview");
    return true;
  }, []);

  const runOperation = useCallback(async (
    name: string,
    operation: MaskOperationSpec,
    context: { sessionId: string; generation: number } = { sessionId: "local", generation: 0 },
  ): Promise<boolean> => {
    const current = bufferRef.current;
    if (!current) return false;
    cancelActiveOperation();
    const sourceRevision = revisionRef.current;
    const rle = current.toRle();
    operationIdRef.current += 1;
    const operationId = operationIdRef.current;
    const controller = new AbortController();
    operationAbortRef.current = controller;
    setOperationStatus("computing");
    setOperationError(undefined);
    try {
      const shouldUseWorker = width * height > 1_000_000
        || ((operation.type === "morphology" || operation.type === "smooth") && operation.radius > 4);
      const result = shouldUseWorker
        ? (await executeRasterMaskOperationAsync(
            rle,
            operation,
            { ...context, operationId },
            { signal: controller.signal },
          )).result
        : applyMaskOperation(current.data, width, height, operation);
      if (controller.signal.aborted || operationIdRef.current !== operationId) return false;
      operationAbortRef.current = null;
      const accepted = previewOperation(name, result, sourceRevision);
      if (!accepted) setOperationStatus("idle");
      return accepted;
    } catch (error) {
      if (operationAbortRef.current === controller) operationAbortRef.current = null;
      const isCurrent = operationIdRef.current === operationId;
      if (error instanceof RasterMaskWorkerCancelledError || controller.signal.aborted) {
        if (isCurrent) setOperationStatus("idle");
        return false;
      }
      if (!isCurrent) return false;
      setOperationError(error);
      setOperationStatus("error");
      return false;
    }
  }, [cancelActiveOperation, height, previewOperation, width]);

  const previewInstanceOperation = useCallback((
    name: string,
    plan: MaskInstanceOperationPlan,
    sourceRevision = revisionRef.current,
  ): boolean => {
    const current = bufferRef.current;
    if (!current || sourceRevision !== revisionRef.current) return false;
    const allAlphas = [plan.primary, plan.focusAlpha, ...plan.created];
    if (allAlphas.some((alpha) => alpha.length !== current.data.length)) {
      throw new Error("mask instance preview dimensions do not match the editor buffer");
    }
    operationIdRef.current += 1;
    const preview: MaskInstanceOperationPreview = {
      id: operationIdRef.current,
      name,
      sourceRevision,
      plan,
    };
    operationPreviewRef.current = null;
    instanceOperationPreviewRef.current = preview;
    setOperationPreview(null);
    setInstanceOperationPreview(preview);
    setOperationError(undefined);
    setOperationStatus("preview");
    return true;
  }, []);

  const runInstanceOperation = useCallback(async (
    name: string,
    operation: MaskInstanceOperationSpec,
    context: { sessionId: string; generation: number } = { sessionId: "local", generation: 0 },
  ): Promise<boolean> => {
    const current = bufferRef.current;
    if (!current) return false;
    cancelActiveOperation();
    const sourceRevision = revisionRef.current;
    const rle = current.toRle();
    operationIdRef.current += 1;
    const operationId = operationIdRef.current;
    const controller = new AbortController();
    operationAbortRef.current = controller;
    setOperationStatus("computing");
    setOperationError(undefined);
    try {
      const plan = width * height > 1_000_000
        ? (await executeRasterMaskInstanceOperationAsync(
            rle,
            operation,
            { ...context, operationId },
            { signal: controller.signal },
          )).plan
        : applyMaskInstanceOperation(current.data, width, height, operation);
      if (controller.signal.aborted || operationIdRef.current !== operationId) return false;
      operationAbortRef.current = null;
      if (!plan) {
        setOperationStatus("idle");
        return false;
      }
      const accepted = previewInstanceOperation(name, plan, sourceRevision);
      if (!accepted) setOperationStatus("idle");
      return accepted;
    } catch (error) {
      if (operationAbortRef.current === controller) operationAbortRef.current = null;
      const isCurrent = operationIdRef.current === operationId;
      if (error instanceof RasterMaskWorkerCancelledError || controller.signal.aborted) {
        if (isCurrent) setOperationStatus("idle");
        return false;
      }
      if (!isCurrent) return false;
      setOperationError(error);
      setOperationStatus("error");
      return false;
    }
  }, [cancelActiveOperation, height, previewInstanceOperation, width]);

  const confirmOperation = useCallback((): boolean => {
    if (instanceOperationPreviewRef.current) return false;
    const preview = operationPreviewRef.current;
    const current = bufferRef.current;
    if (!preview || !current || preview.sourceRevision !== revisionRef.current) {
      clearOperationPreview();
      return false;
    }
    const before = current.toRle();
    const change = current.replaceAlpha(preview.alpha);
    clearOperationPreview();
    if (change.changedPixels === 0) return false;
    const after = current.toRle();
    undoRef.current = [...undoRef.current.slice(-19), {
      name: preview.name,
      before,
      after,
      report: preview.report,
    }];
    redoRef.current = [];
    setDirty(true);
    setHistoryRevision((value) => value + 1);
    bump();
    return true;
  }, [bump, clearOperationPreview]);

  const cancelOperation = useCallback(() => {
    cancelActiveOperation();
  }, [cancelActiveOperation]);

  const cancel = useCallback(() => {
    bufferRef.current = null;
    setActive(false);
    setDirty(false);
    resetHistory();
    cancelActiveOperation();
    bump();
  }, [bump, cancelActiveOperation, resetHistory]);

  const commitToPolygon = useCallback(() => {
    const buffer = bufferRef.current;
    if (!buffer) return null;
    const result = maskToPolygon(buffer);
    return result.points.length < 3 ? null : result;
  }, []);

  const commitToRle = useCallback((): CocoRle | null => {
    return bufferRef.current?.toRle() ?? null;
  }, []);

  return {
    active,
    mode,
    tool,
    brushShape,
    connectivity,
    radius,
    dirty,
    buffer: bufferRef.current,
    revision,
    canUndo: undoRef.current.length > 0,
    canRedo: redoRef.current.length > 0,
    operationPreview,
    instanceOperationPreview,
    operationStatus,
    operationError,
    beginBlank,
    initFromPolygon,
    initFromRle,
    materializeFromRle,
    paintAt,
    beginStroke,
    endStroke,
    undo,
    redo,
    setMode,
    setTool,
    setBrushShape,
    setConnectivity,
    setRadius,
    previewOperation,
    runOperation,
    previewInstanceOperation,
    runInstanceOperation,
    confirmOperation,
    cancelOperation,
    cancel,
    commitToPolygon,
    commitToRle,
  };
}
