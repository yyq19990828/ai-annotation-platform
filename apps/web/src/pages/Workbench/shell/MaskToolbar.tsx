// v0.10.8 M4-δ 收尾 · I11 · Mask 编辑器浮条。
//
// 浮在 ImageStage container 顶部居中，仅 tool === "mask" 时渲染。
// 半径 slider [1, 200] / 笔刷·橡皮 chips / 确认 / 取消 / dirty 指示。

import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { MASK_BRUSH_MIN_PX, MASK_BRUSH_MAX_PX, type MaskMode } from "../state/useMaskEditor";

interface MaskToolbarProps {
  active: boolean;
  mode: MaskMode;
  radius: number;
  dirty: boolean;
  onSetMode: (m: MaskMode) => void;
  onSetRadius: (r: number) => void;
  onCommit: () => void;
  onCancel: () => void;
}

const cn = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

// 模式切换按钮：颜色 utility 按 active/idle 互斥下发。朴素 cn() 不做 tailwind-merge，
// 若把中性色塞进无条件基础类，会与激活色类同挂、由 CSS 源顺序静默裁决导致高亮失效。
const MODE_BTN_BASE = "cursor-pointer appearance-none rounded border px-2.5 py-1 text-xs";
const MODE_BTN_IDLE = "border-border bg-transparent text-foreground";
const MODE_BTN_ACTIVE = "border-brand/30 bg-brand/10 text-brand";

export function MaskToolbar({
  active, mode, radius, dirty,
  onSetMode, onSetRadius, onCommit, onCancel,
}: MaskToolbarProps) {
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
          onClick={() => onSetMode("brush")}
          className={cn(MODE_BTN_BASE, mode === "brush" ? MODE_BTN_ACTIVE : MODE_BTN_IDLE)}
          title="笔刷 (B)"
          data-testid="mask-mode-brush"
        >笔刷 B</button>
        <button
          type="button"
          onClick={() => onSetMode("erase")}
          className={cn(MODE_BTN_BASE, mode === "erase" ? MODE_BTN_ACTIVE : MODE_BTN_IDLE)}
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
        {dirty ? "未保存" : active ? "就绪" : "未激活"}
      </span>
      <span className="text-2xs text-muted-foreground">Shift+滚轮调半径</span>
      <Button size="sm" onClick={onCancel} title="取消 (Esc)">
        取消
      </Button>
      <Button size="sm" variant="primary" onClick={onCommit} disabled={!active || !dirty} title="确认 (Enter)">
        <Icon name="check" size={11} /> 确认
      </Button>
    </div>
  );
}
