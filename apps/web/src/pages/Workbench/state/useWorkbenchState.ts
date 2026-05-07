import { useCallback, useState } from "react";
import type { Annotation } from "@/types";
import type { CommentCanvasDrawing } from "@/api/comments";

export type Tool = "box" | "hand" | "polygon" | "canvas" | "sam";

/**
 * v0.9.4 phase 2 · SAM 工具子模式 (`Tool === "sam"` 时生效).
 * point: 单击产生 positive point prompt; Alt+点击 / polarity=negative 产生 negative point.
 * bbox:  拖框产生 bbox prompt (单击不响应).
 * text:  画布事件不响应; 焦点切到右栏 SamTextPanel 输入框.
 */
export type SamSubTool = "point" | "bbox" | "text";

/** SAM-point 子工具下的 polarity, "+" / "-" 键切换; 仅 sam-point 时有意义. */
export type SamPolarity = "positive" | "negative";

const SAM_CYCLE: SamSubTool[] = ["point", "bbox", "text"];

export function nextSamSubTool(current: SamSubTool): SamSubTool {
  const i = SAM_CYCLE.indexOf(current);
  return SAM_CYCLE[(i + 1) % SAM_CYCLE.length];
}

/** v0.6.4：canvas 工具激活时的草稿状态。
 *  CommentInput 点「在题图上绘制」→ beginCanvasDraft；ImageStage 在 canvas tool 下
 *  读取 active + shapes 渲染 + 写入新笔触；用户点 Done → endCanvasDraft 把结果
 *  挂到 pendingResult，CommentInput 监听后回写并清空。 */
export type CanvasDraft = {
  active: boolean;
  /** 关联的评论上下文（可选；用于多 Annotation 上下文时区分）。 */
  annotationId: string | null;
  shapes: NonNullable<CommentCanvasDrawing["shapes"]>;
  stroke: string;
  /** 提交后由 hook 写入；CommentInput effect 消费后清空。 */
  pendingResult: CommentCanvasDrawing | null;
};

const DEFAULT_CANVAS_STROKE = "#ef4444";

export type Geom = { x: number; y: number; w: number; h: number };

export type PendingDrawing = { geom: Geom } | null;

/** 选中已落库 user 框后，再次"改类别"时的状态。 */
export type EditingClass = {
  annotationId: string;
  geom: Geom;
  currentClass: string;
} | null;

export function useWorkbenchState() {
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("box");
  // v0.9.4 phase 2 · SAM 子工具 (point/bbox/text) + polarity (+/−) + 文本焦点 trigger.
  const [samSubTool, setSamSubTool] = useState<SamSubTool>("point");
  const [samPolarity, setSamPolarity] = useState<SamPolarity>("positive");
  // text 子工具激活时让 SamTextPanel 抓焦点; 每次切到 text 自增, useEffect 依赖此值即可.
  const [samTextFocusKey, setSamTextFocusKey] = useState(0);
  /**
   * activeClass 语义：默认/最近使用类别。仅作为绘制时浮框颜色预览 + popover 的默认选中。
   * 实际类别在画完框 → ClassPickerPopover 中确认。
   */
  const [activeClass, setActiveClass] = useState("");
  const [pendingDrawing, setPendingDrawing] = useState<PendingDrawing>(null);
  const [editingClass, setEditingClass] = useState<EditingClass>(null);
  /**
   * 多选语义：
   * - selectedId：primary（用于 SelectionOverlay 浮按钮锚点 / 单体快捷键）
   * - selectedIds：包含 primary 在内的全部选中 user 框 id
   * 选 AI 框时永远是单选（selectedIds 只含一个 ai id）
   */
  const [selectedId, setSelectedIdRaw] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confThreshold, setConfThreshold] = useState(0.5);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [leftWidth, setLeftWidthRaw] = useState<number>(() => {
    try {
      const v = parseInt(localStorage.getItem("workbench.leftWidth") ?? "");
      return Number.isFinite(v) && v >= 200 && v <= 560 ? v : 260;
    } catch { return 260; }
  });
  const [rightWidth, setRightWidthRaw] = useState<number>(() => {
    try {
      const v = parseInt(localStorage.getItem("workbench.rightWidth") ?? "");
      return Number.isFinite(v) && v >= 220 && v <= 600 ? v : 280;
    } catch { return 280; }
  });
  const setLeftWidth = useCallback((w: number) => {
    const clamped = Math.max(200, Math.min(560, Math.round(w)));
    setLeftWidthRaw(clamped);
    try { localStorage.setItem("workbench.leftWidth", String(clamped)); } catch { /* noop */ }
  }, []);
  const setRightWidth = useCallback((w: number) => {
    const clamped = Math.max(220, Math.min(600, Math.round(w)));
    setRightWidthRaw(clamped);
    try { localStorage.setItem("workbench.rightWidth", String(clamped)); } catch { /* noop */ }
  }, []);
  /** 同任务内剪贴板（仅本会话内存）。 */
  const [clipboard, setClipboard] = useState<Annotation[]>([]);
  /** v0.6.4：canvas 批注草稿。reviewer / annotator 在题图上画红圈时使用。*/
  const [canvasDraft, setCanvasDraft] = useState<CanvasDraft>({
    active: false,
    annotationId: null,
    shapes: [],
    stroke: DEFAULT_CANVAS_STROKE,
    pendingResult: null,
  });

  const beginCanvasDraft = useCallback((annotationId: string | null, initial?: CommentCanvasDrawing | null) => {
    setCanvasDraft({
      active: true,
      annotationId,
      shapes: initial?.shapes ?? [],
      stroke: DEFAULT_CANVAS_STROKE,
      pendingResult: null,
    });
    setTool("canvas");
  }, []);

  const appendCanvasShape = useCallback((shape: CanvasDraft["shapes"][number]) => {
    setCanvasDraft((d) => ({ ...d, shapes: [...d.shapes, shape] }));
  }, []);

  const undoCanvasShape = useCallback(() => {
    setCanvasDraft((d) => ({ ...d, shapes: d.shapes.slice(0, -1) }));
  }, []);

  const clearCanvasShapes = useCallback(() => {
    setCanvasDraft((d) => ({ ...d, shapes: [] }));
  }, []);

  const setCanvasStroke = useCallback((stroke: string) => {
    setCanvasDraft((d) => ({ ...d, stroke }));
  }, []);

  /** 提交：把当前 shapes 打包到 pendingResult，CommentInput 消费后清空。 */
  const endCanvasDraft = useCallback(() => {
    setCanvasDraft((d) => ({
      ...d,
      active: false,
      pendingResult: d.shapes.length > 0 ? { shapes: d.shapes } : { shapes: [] },
    }));
    setTool("box");
  }, []);

  const cancelCanvasDraft = useCallback(() => {
    setCanvasDraft({
      active: false,
      annotationId: null,
      shapes: [],
      stroke: DEFAULT_CANVAS_STROKE,
      pendingResult: null,
    });
    setTool("box");
  }, []);

  const consumeCanvasResult = useCallback(() => {
    setCanvasDraft((d) => ({ ...d, pendingResult: null, annotationId: null }));
  }, []);

  /** 设置 primary，同时把 selectedIds 收敛到 [id] 或 []。 */
  const setSelectedId = useCallback((id: string | null) => {
    setSelectedIdRaw(id);
    setSelectedIds(id ? [id] : []);
  }, []);

  /** 切换某 id 的选中态（Shift+click 用）。primary 跟随最后一次切入的 id。 */
  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        const next = prev.filter((x) => x !== id);
        setSelectedIdRaw(next[next.length - 1] ?? null);
        return next;
      }
      const next = [...prev, id];
      setSelectedIdRaw(id);
      return next;
    });
  }, []);

  /** 替换全部选中 id（Ctrl+A 用）。 */
  const replaceSelected = useCallback((ids: string[]) => {
    setSelectedIds(ids);
    setSelectedIdRaw(ids[ids.length - 1] ?? null);
  }, []);

  return {
    currentTaskId, setCurrentTaskId,
    tool, setTool,
    // v0.9.4 phase 2 · SAM 子工具栏
    samSubTool, setSamSubTool,
    samPolarity, setSamPolarity,
    samTextFocusKey, bumpSamTextFocus: () => setSamTextFocusKey((k) => k + 1),
    activeClass, setActiveClass,
    pendingDrawing, setPendingDrawing,
    editingClass, setEditingClass,
    selectedId, setSelectedId,
    selectedIds, toggleSelected, replaceSelected,
    confThreshold, setConfThreshold,
    leftOpen, setLeftOpen,
    rightOpen, setRightOpen,
    leftWidth, setLeftWidth,
    rightWidth, setRightWidth,
    clipboard, setClipboard,
    canvasDraft,
    beginCanvasDraft, endCanvasDraft, cancelCanvasDraft,
    appendCanvasShape, undoCanvasShape, clearCanvasShapes,
    setCanvasStroke, consumeCanvasResult,
  };
}

export type WorkbenchState = ReturnType<typeof useWorkbenchState>;
