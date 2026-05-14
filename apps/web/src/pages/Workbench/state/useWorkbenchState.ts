import { useCallback, useMemo, useState } from "react";
import type { Annotation } from "@/types";
import type { CommentCanvasDrawing } from "@/api/comments";

// v0.10.2 · Tool union 扩展: 旧 "sam" 拆为 4 个独立 AI 工具 (smart-point / smart-box /
// text-prompt / exemplar), 每个绑定一个 prompt 范式. 状态层仅保留 polarity (smart-point
// 用) 和 aiToolParams (AIToolDrawer 用); samSubTool 由 tool 派生, 不再独立持有.
export type Tool =
  | "box"
  | "hand"
  | "polygon"
  | "canvas"
  | "smart-point"
  | "smart-box"
  | "text-prompt"
  | "exemplar";
export type VideoTool = "box" | "track";

/**
 * v0.10.2 · 派生型 SAM 子工具, 仅作 ImageStage / AIInspectorPanel 等老消费者的兼容外观.
 * 取值由 tool 决定; tool 不是 AI 工具时为 null.
 */
export type SamSubTool = "point" | "bbox" | "text" | "exemplar";

/** SAM-point 子工具下的 polarity, "+" / "-" 键切换; 仅 smart-point 时有意义. */
export type SamPolarity = "positive" | "negative";

/** v0.10.2 · 由 tool 派生 samSubTool, 给老消费者用 (ImageStage / AIInspectorPanel). */
export function toolToSamSubTool(tool: Tool): SamSubTool | null {
  switch (tool) {
    case "smart-point":
      return "point";
    case "smart-box":
      return "bbox";
    case "text-prompt":
      return "text";
    case "exemplar":
      return "exemplar";
    default:
      return null;
  }
}

const AI_TOOL_CYCLE: Tool[] = ["smart-point", "smart-box", "text-prompt", "exemplar"];

/** v0.10.2 · S 键循环 4 个 AI 工具; isEnabled 判定是否跳过 (置灰工具). */
export function nextAITool(current: Tool, isEnabled: (t: Tool) => boolean): Tool {
  const i = AI_TOOL_CYCLE.indexOf(current);
  if (i < 0) {
    return AI_TOOL_CYCLE.find(isEnabled) ?? "box";
  }
  for (let k = 1; k <= AI_TOOL_CYCLE.length; k++) {
    const next = AI_TOOL_CYCLE[(i + k) % AI_TOOL_CYCLE.length];
    if (next === AI_TOOL_CYCLE[0] && k === AI_TOOL_CYCLE.length) return "box";
    if (isEnabled(next)) return next;
  }
  return "box";
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

export type PendingDrawing =
  | { kind?: "bbox"; geom: Geom }
  | {
      kind: "video_bbox" | "video_track";
      frameIndex: number;
      geom: Geom;
      anchor: { left: number; top: number };
    }
  | null;

/** 选中已落库 user 框后，再次"改类别"时的状态。 */
export type EditingClass = {
  annotationId: string;
  geom: Geom;
  currentClass: string;
  anchor?: { left: number; top: number };
} | null;

export function useWorkbenchState() {
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("box");
  const [videoTool, setVideoTool] = useState<VideoTool>("box");
  const [videoFrameIndex, setVideoFrameIndex] = useState(0);
  const [hiddenVideoTrackIds, setHiddenVideoTrackIds] = useState<Set<string>>(() => new Set());
  const [lockedVideoTrackIds, setLockedVideoTrackIds] = useState<Set<string>>(() => new Set());
  // v0.10.2 · samSubTool 改为派生 (见 toolToSamSubTool); polarity + aiToolParams 仍是 state.
  const [samPolarity, setSamPolarity] = useState<SamPolarity>("positive");
  // text 子工具激活时让 AIToolDrawer 抓焦点; 每次切到 text-prompt 自增.
  const [samTextFocusKey, setSamTextFocusKey] = useState(0);
  /** v0.10.2 · AIToolDrawer 维护的后端参数 (来自 /setup.params schema). 切换工具时重置. */
  const [aiToolParams, setAiToolParams] = useState<Record<string, unknown>>({});
  const samSubTool = useMemo(() => toolToSamSubTool(tool), [tool]);
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
  // confThreshold: AI 框前端展示阈值 (b.conf >= confThreshold 才进 aiBoxes).
  // 注意: 这是前端过滤, 不重跑模型; "全部采纳"也只会采纳过滤后还显示的框.
  // 改 DINO 召回阈值要去 项目设置 → AI 配置 → box_threshold / text_threshold.
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
  const toggleHiddenVideoTrack = useCallback((trackId: string) => {
    setHiddenVideoTrackIds((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  }, []);
  const toggleLockedVideoTrack = useCallback((trackId: string) => {
    setLockedVideoTrackIds((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  }, []);
  const resetVideoStageUi = useCallback(() => {
    setVideoFrameIndex(0);
    setHiddenVideoTrackIds(new Set());
    setLockedVideoTrackIds(new Set());
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
    videoTool, setVideoTool,
    videoFrameIndex, setVideoFrameIndex,
    hiddenVideoTrackIds, lockedVideoTrackIds,
    toggleHiddenVideoTrack, toggleLockedVideoTrack, resetVideoStageUi,
    // v0.10.2 · 派生 samSubTool (read-only) + polarity + AI 工具参数 + 文本焦点 trigger.
    samSubTool,
    samPolarity, setSamPolarity,
    samTextFocusKey, bumpSamTextFocus: () => setSamTextFocusKey((k) => k + 1),
    aiToolParams, setAiToolParams,
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
