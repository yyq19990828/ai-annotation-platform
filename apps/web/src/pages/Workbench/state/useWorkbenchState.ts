import { useState } from "react";

export type Tool = "box" | "hand";

export function useWorkbenchState() {
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("box");
  const [activeClass, setActiveClass] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confThreshold, setConfThreshold] = useState(0.5);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  return {
    currentTaskId, setCurrentTaskId,
    tool, setTool,
    activeClass, setActiveClass,
    selectedId, setSelectedId,
    confThreshold, setConfThreshold,
    leftOpen, setLeftOpen,
    rightOpen, setRightOpen,
  };
}

export type WorkbenchState = ReturnType<typeof useWorkbenchState>;
