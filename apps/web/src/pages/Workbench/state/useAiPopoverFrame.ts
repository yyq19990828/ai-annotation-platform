// v0.16.x 第 3 批 · 从 useWorkbenchShellModel 抽出的 AI 预标浮层"边框"状态:
// 浮层位置(拖动)+ 尺寸(拖角缩放),均持久化到 localStorage 全局 UI 偏好。
// 这是 AI 配置面板里唯一与其它特性零共享、零外部依赖的部分 —— 与 usePsrFloatingPanel
// 同模式;面板的开关(aiPopoverOpen,切 task 时被关闭故与任务流纠缠)、后端选择
// (batchBackendId)、preCfg、运行回调均留壳层(评估见计划 §5/§7)。逐字搬运,行为零变化。
import { useFloatingPanelFrame } from "./useFloatingPanelFrame";

const AI_POPOVER_POSITION_KEY = "wb:ai-popover-position";
const AI_POPOVER_SIZE_KEY = "wb:ai-popover-size";

export function useAiPopoverFrame() {
  const {
    position: aiPopoverPosition,
    setPosition: setAiPopoverPosition,
    size: aiPopoverSize,
    setSize: setAiPopoverSize,
  } = useFloatingPanelFrame({
    position: AI_POPOVER_POSITION_KEY,
    size: AI_POPOVER_SIZE_KEY,
  });

  return { aiPopoverPosition, setAiPopoverPosition, aiPopoverSize, setAiPopoverSize };
}
