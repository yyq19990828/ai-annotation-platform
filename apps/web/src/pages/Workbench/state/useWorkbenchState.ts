import { useCallback, useState } from "react";
import type { Annotation } from "@/types";

export type Tool = "box" | "hand";

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
  /** 同任务内剪贴板（仅本会话内存）。 */
  const [clipboard, setClipboard] = useState<Annotation[]>([]);

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
    activeClass, setActiveClass,
    pendingDrawing, setPendingDrawing,
    editingClass, setEditingClass,
    selectedId, setSelectedId,
    selectedIds, toggleSelected, replaceSelected,
    confThreshold, setConfThreshold,
    leftOpen, setLeftOpen,
    rightOpen, setRightOpen,
    clipboard, setClipboard,
  };
}

export type WorkbenchState = ReturnType<typeof useWorkbenchState>;
