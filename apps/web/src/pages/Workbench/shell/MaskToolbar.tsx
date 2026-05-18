// v0.10.8 M4-δ 收尾 · I11 · Mask 编辑器浮条。
//
// 浮在 ImageStage container 顶部居中，仅 tool === "mask" 时渲染。
// 半径 slider [1, 200] / 笔刷·橡皮 chips / 确认 / 取消 / dirty 指示。

import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { MASK_BRUSH_MIN_PX, MASK_BRUSH_MAX_PX, type MaskMode } from "../state/useMaskEditor";
import styles from "./MaskToolbar.module.css";

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

export function MaskToolbar({
  active, mode, radius, dirty,
  onSetMode, onSetRadius, onCommit, onCancel,
}: MaskToolbarProps) {
  return (
    <div
      data-testid="mask-toolbar"
      className={styles.root}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <span className={styles.title}>Mask 编辑</span>
      <div className={styles.modeGroup}>
        <button
          type="button"
          onClick={() => onSetMode("brush")}
          className={cn(styles.chip, mode === "brush" && styles.chipActive)}
          title="笔刷 (B)"
          data-testid="mask-mode-brush"
        >笔刷 B</button>
        <button
          type="button"
          onClick={() => onSetMode("erase")}
          className={cn(styles.chip, mode === "erase" && styles.chipActive)}
          title="橡皮 (E)"
          data-testid="mask-mode-erase"
        >橡皮 E</button>
      </div>
      <div className={styles.radiusGroup}>
        <span className={styles.radiusLabel}>半径</span>
        <input
          type="range"
          min={MASK_BRUSH_MIN_PX}
          max={MASK_BRUSH_MAX_PX}
          step={1}
          value={radius}
          onChange={(e) => onSetRadius(parseInt(e.target.value, 10))}
          className={styles.radiusSlider}
          data-testid="mask-radius-slider"
        />
        <span className={cn("mono", styles.radiusValue)}>
          {radius}px
        </span>
      </div>
      <span className={cn(styles.status, dirty && styles.statusDirty)}>
        {dirty ? "未保存" : active ? "就绪" : "未激活"}
      </span>
      <span className={styles.hint}>Shift+滚轮调半径</span>
      <Button size="sm" onClick={onCancel} title="取消 (Esc)">
        取消
      </Button>
      <Button size="sm" variant="primary" onClick={onCommit} disabled={!active || !dirty} title="确认 (Enter)">
        <Icon name="check" size={11} /> 确认
      </Button>
    </div>
  );
}
