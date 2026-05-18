// v0.6.4 · 画布批注工具浮条。
//
// 浮在 ImageStage container 右上角，绝对定位。仅当 canvasDraft.active 时渲染。
// 颜色 swatch + 撤销 / 清空 / 取消 / 完成。
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import styles from "./CanvasToolbar.module.css";

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
  { value: "#ef4444", label: "红", className: styles.swatchRed },
  { value: "#f59e0b", label: "黄", className: styles.swatchYellow },
  { value: "#10b981", label: "绿", className: styles.swatchGreen },
  { value: "#3b82f6", label: "蓝", className: styles.swatchBlue },
];

export function CanvasToolbar({ stroke, onSetStroke, shapeCount, onUndo, onClear, onCancel, onDone }: Props) {
  return (
    <div
      className={styles.root}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <span className={styles.label}>颜色</span>
      {SWATCHES.map((c) => (
        <button
          key={c.value}
          type="button"
          onClick={() => onSetStroke(c.value)}
          aria-label={c.label}
          className={[
            styles.swatch,
            c.className,
            stroke === c.value ? styles.swatchActive : "",
          ].filter(Boolean).join(" ")}
        />
      ))}
      <span className={styles.count}>{shapeCount} 条</span>
      <Button size="sm" onClick={onUndo} disabled={shapeCount === 0}>
        <Icon name="trash" size={11} /> 撤销
      </Button>
      <Button size="sm" onClick={onClear} disabled={shapeCount === 0}>清空</Button>
      <Button size="sm" onClick={onCancel}>取消</Button>
      <Button size="sm" variant="primary" onClick={onDone}>完成</Button>
    </div>
  );
}
