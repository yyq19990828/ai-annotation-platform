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

const chipStyle = (active: boolean): React.CSSProperties => ({
  padding: "3px 10px",
  fontSize: 11,
  borderRadius: 4,
  cursor: "pointer",
  background: active ? "var(--color-accent)" : "transparent",
  color: active ? "white" : "var(--color-fg)",
  border: "1px solid " + (active ? "var(--color-accent)" : "var(--color-border)"),
  fontFamily: "inherit",
});

export function MaskToolbar({
  active, mode, radius, dirty,
  onSetMode, onSetRadius, onCommit, onCancel,
}: MaskToolbarProps) {
  return (
    <div
      data-testid="mask-toolbar"
      style={{
        position: "absolute",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "6px 12px",
        background: "var(--color-bg-elev)",
        border: "1px solid var(--color-border)",
        borderRadius: 6,
        boxShadow: "var(--shadow-md)",
        zIndex: 5,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-fg)" }}>Mask 编辑</span>
      <div style={{ display: "flex", gap: 4 }}>
        <button
          type="button"
          onClick={() => onSetMode("brush")}
          style={chipStyle(mode === "brush")}
          title="笔刷 (B)"
          data-testid="mask-mode-brush"
        >笔刷 B</button>
        <button
          type="button"
          onClick={() => onSetMode("erase")}
          style={chipStyle(mode === "erase")}
          title="橡皮 (E)"
          data-testid="mask-mode-erase"
        >橡皮 E</button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 11, color: "var(--color-fg-muted)" }}>半径</span>
        <input
          type="range"
          min={MASK_BRUSH_MIN_PX}
          max={MASK_BRUSH_MAX_PX}
          step={1}
          value={radius}
          onChange={(e) => onSetRadius(parseInt(e.target.value, 10))}
          style={{ width: 100 }}
          data-testid="mask-radius-slider"
        />
        <span className="mono" style={{ fontSize: 11, color: "var(--color-fg)", minWidth: 28, textAlign: "right" }}>
          {radius}px
        </span>
      </div>
      <span style={{ fontSize: 11, color: dirty ? "var(--color-warning)" : "var(--color-fg-subtle)" }}>
        {dirty ? "未保存" : active ? "就绪" : "未激活"}
      </span>
      <span style={{ fontSize: 10, color: "var(--color-fg-subtle)" }}>Shift+滚轮调半径</span>
      <Button size="sm" onClick={onCancel} title="取消 (Esc)">
        取消
      </Button>
      <Button size="sm" variant="primary" onClick={onCommit} disabled={!active || !dirty} title="确认 (Enter)">
        <Icon name="check" size={11} /> 确认
      </Button>
    </div>
  );
}
