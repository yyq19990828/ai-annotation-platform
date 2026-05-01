// v0.6.4 · 画布批注工具浮条。
//
// 浮在 ImageStage container 右上角，绝对定位。仅当 canvasDraft.active 时渲染。
// 颜色 swatch + 撤销 / 清空 / 取消 / 完成。
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

interface Props {
  stroke: string;
  onSetStroke: (color: string) => void;
  shapeCount: number;
  onUndo: () => void;
  onClear: () => void;
  onCancel: () => void;
  onDone: () => void;
}

const SWATCHES = [
  { value: "#ef4444", label: "红" },
  { value: "#f59e0b", label: "黄" },
  { value: "#10b981", label: "绿" },
  { value: "#3b82f6", label: "蓝" },
];

export function CanvasToolbar({ stroke, onSetStroke, shapeCount, onUndo, onClear, onCancel, onDone }: Props) {
  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        right: 12,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        background: "var(--color-bg-elev)",
        border: "1px solid var(--color-border)",
        borderRadius: 6,
        boxShadow: "var(--shadow-md)",
        zIndex: 5,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <span style={{ fontSize: 11, color: "var(--color-fg-muted)" }}>颜色</span>
      {SWATCHES.map((c) => (
        <button
          key={c.value}
          type="button"
          onClick={() => onSetStroke(c.value)}
          aria-label={c.label}
          style={{
            width: 18,
            height: 18,
            borderRadius: "50%",
            border: stroke === c.value ? "2px solid var(--color-fg)" : "1px solid var(--color-border)",
            background: c.value,
            cursor: "pointer",
            padding: 0,
          }}
        />
      ))}
      <span style={{ fontSize: 11, color: "var(--color-fg-muted)", marginLeft: 4 }}>{shapeCount} 条</span>
      <Button size="sm" onClick={onUndo} disabled={shapeCount === 0}>
        <Icon name="trash" size={11} /> 撤销
      </Button>
      <Button size="sm" onClick={onClear} disabled={shapeCount === 0}>清空</Button>
      <Button size="sm" onClick={onCancel}>取消</Button>
      <Button size="sm" variant="primary" onClick={onDone}>完成</Button>
    </div>
  );
}
