// v0.10.8 M4-δ 收尾 · I11 · Mask 编辑器浮条。
//
// 浮在 ImageStage container 顶部居中，仅 tool === "mask" 时渲染。
// 半径 slider [1, 200] / 笔刷·橡皮 chips / 确认 / 取消 / dirty 指示。

import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { MASK_BRUSH_MIN_PX, MASK_BRUSH_MAX_PX, type MaskMode } from "../state/useMaskEditor";
import type { MaskEditorPhase } from "../state/canEditMask";

interface MaskToolbarProps {
  active: boolean;
  mode: MaskMode;
  radius: number;
  dirty: boolean;
  phase: MaskEditorPhase;
  canUndo: boolean;
  canRedo: boolean;
  /** v0.23.5 · WS-C · 经 canEditMask 的统一准入; false 时禁用笔刷/橡皮/确认。 */
  canEdit: boolean;
  onSetMode: (m: MaskMode) => void;
  onSetRadius: (r: number) => void;
  onCommit: () => void;
  onCancel: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onRetry?: () => void;
}

const cn = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

// 模式切换按钮：颜色 utility 按 active/idle 互斥下发。朴素 cn() 不做 tailwind-merge，
// 若把中性色塞进无条件基础类，会与激活色类同挂、由 CSS 源顺序静默裁决导致高亮失效。
const MODE_BTN_BASE = "cursor-pointer appearance-none rounded border px-2.5 py-1 text-xs";
const MODE_BTN_IDLE = "border-border bg-transparent text-foreground";
const MODE_BTN_ACTIVE = "border-brand/30 bg-brand/10 text-brand";

export function MaskToolbar({
  active, mode, radius, dirty, phase, canUndo, canRedo, canEdit,
  onSetMode, onSetRadius, onCommit, onCancel, onUndo, onRedo, onRetry,
}: MaskToolbarProps) {
  const phaseLabel: Record<MaskEditorPhase, string> = {
    idle: "未激活",
    loading: "加载中",
    ready: "就绪",
    dirty: "未保存",
    saving: "保存中",
    error: "操作失败",
  };
  return (
    <div
      data-testid="mask-toolbar"
      className="absolute left-1/2 top-3 z-local-5 flex -translate-x-1/2 items-center gap-2.5 rounded-md border border-border bg-card px-3 py-1.5 shadow-md"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <span className="text-xs font-semibold text-foreground">Mask 编辑</span>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => canEdit && onSetMode("brush")}
          disabled={!canEdit}
          className={cn(MODE_BTN_BASE, mode === "brush" ? MODE_BTN_ACTIVE : MODE_BTN_IDLE, !canEdit && "opacity-50 cursor-not-allowed")}
          title="笔刷 (B)"
          data-testid="mask-mode-brush"
        >笔刷 B</button>
        <button
          type="button"
          onClick={() => canEdit && onSetMode("erase")}
          disabled={!canEdit}
          className={cn(MODE_BTN_BASE, mode === "erase" ? MODE_BTN_ACTIVE : MODE_BTN_IDLE, !canEdit && "opacity-50 cursor-not-allowed")}
          title="橡皮 (E)"
          data-testid="mask-mode-erase"
        >橡皮 E</button>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">半径</span>
        <input
          type="range"
          min={MASK_BRUSH_MIN_PX}
          max={MASK_BRUSH_MAX_PX}
          step={1}
          value={radius}
          onChange={(e) => onSetRadius(parseInt(e.target.value, 10))}
          className="w-[100px]"
          data-testid="mask-radius-slider"
        />
        <span className="mono min-w-[28px] text-right text-xs text-foreground">
          {radius}px
        </span>
      </div>
      <span className={cn("text-xs", dirty ? "text-status-caution" : "text-muted-foreground")}>
        {phaseLabel[phase]}
      </span>
      <Button size="sm" variant="ghost" onClick={onUndo} disabled={!canEdit || !canUndo} title="撤销笔画 (Ctrl+Z)">
        撤销
      </Button>
      <Button size="sm" variant="ghost" onClick={onRedo} disabled={!canEdit || !canRedo} title="重做笔画 (Ctrl+Y)">
        重做
      </Button>
      {phase === "error" && onRetry && (
        <Button size="sm" variant="ghost" onClick={onRetry} title="恢复或重试 Mask">
          重试
        </Button>
      )}
      <span className="text-2xs text-muted-foreground">Shift+滚轮调半径</span>
      <Button size="sm" onClick={onCancel} title="取消 (Esc)">
        取消
      </Button>
      <Button size="sm" variant="primary" onClick={onCommit} disabled={!canEdit || !active || !dirty || phase !== "dirty"} title="确认 (Enter)">
        <Icon name="check" size={11} /> 确认
      </Button>
    </div>
  );
}
