// v0.16.x 第 3 批 · 从 useWorkbenchShellModel 抽出的 AI 预标浮层"边框"状态:
// 浮层位置(拖动)+ 尺寸(拖角缩放,持久化到 localStorage 全局 UI 偏好)。
// 这是 AI 配置面板里唯一与其它特性零共享、零外部依赖的部分 —— 与 usePsrFloatingPanel
// 同模式;面板的开关(aiPopoverOpen,切 task 时被关闭故与任务流纠缠)、后端选择
// (batchBackendId)、preCfg、运行回调均留壳层(评估见计划 §5/§7)。逐字搬运,行为零变化。
import { useEffect, useState } from "react";

const AI_POPOVER_SIZE_KEY = "wb:ai-popover-size";

export function useAiPopoverFrame() {
  const [aiPopoverPosition, setAiPopoverPosition] = useState<{ left: number; top: number } | null>(
    null,
  );
  // v0.14.18 · AI 面板可缩放 (与浮出边栏一致); null = 用 CSS 默认尺寸, 用户拖角后置显式 w/h.
  // 持久化到 localStorage (全局 UI 偏好, 非按项目): 刷新后保留拖定的尺寸。
  const [aiPopoverSize, setAiPopoverSize] = useState<{ w: number; h: number } | null>(() => {
    try {
      const raw = localStorage.getItem(AI_POPOVER_SIZE_KEY);
      const v = raw ? JSON.parse(raw) : null;
      return typeof v?.w === "number" && typeof v?.h === "number" ? { w: v.w, h: v.h } : null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    try {
      if (aiPopoverSize) localStorage.setItem(AI_POPOVER_SIZE_KEY, JSON.stringify(aiPopoverSize));
      else localStorage.removeItem(AI_POPOVER_SIZE_KEY);
    } catch {
      /* ignore quota / privacy mode */
    }
  }, [aiPopoverSize]);

  return { aiPopoverPosition, setAiPopoverPosition, aiPopoverSize, setAiPopoverSize };
}
