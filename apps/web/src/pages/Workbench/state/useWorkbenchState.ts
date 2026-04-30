import { useState } from "react";

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confThreshold, setConfThreshold] = useState(0.5);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  return {
    currentTaskId, setCurrentTaskId,
    tool, setTool,
    activeClass, setActiveClass,
    pendingDrawing, setPendingDrawing,
    editingClass, setEditingClass,
    selectedId, setSelectedId,
    confThreshold, setConfThreshold,
    leftOpen, setLeftOpen,
    rightOpen, setRightOpen,
  };
}

export type WorkbenchState = ReturnType<typeof useWorkbenchState>;
