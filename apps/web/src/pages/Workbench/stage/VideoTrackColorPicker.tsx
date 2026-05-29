import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { TRACK_COLOR_PALETTE } from "./colors";
import styles from "./VideoTrackColorPicker.module.css";

type SwatchVars = CSSProperties & { "--swatch-color": string };

interface VideoTrackColorPickerProps {
  /** 当前生效色（用于高亮选中的色块）。 */
  currentColor: string;
  /** 是否存在覆盖色（决定是否显示「恢复默认」）。 */
  hasOverride: boolean;
  onPick: (color: string) => void;
  onReset: () => void;
  onClose: () => void;
}

/** 轻量 track 取色器：从固定调色板选色，或恢复默认（按 track_id 派生色）。 */
export function VideoTrackColorPicker({
  currentColor,
  hasOverride,
  onPick,
  onReset,
  onClose,
}: VideoTrackColorPickerProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [onClose]);

  return (
    <div ref={rootRef} className={styles.picker} role="dialog" aria-label="选择轨迹颜色">
      <div className={styles.swatches}>
        {TRACK_COLOR_PALETTE.map((entry) => (
          <button
            key={entry.value}
            type="button"
            title={entry.label}
            aria-label={entry.label}
            aria-pressed={entry.value === currentColor}
            className={entry.value === currentColor ? `${styles.swatch} ${styles.swatchActive}` : styles.swatch}
            // eslint-disable-next-line no-restricted-syntax -- 动态色块色值经 CSS custom property 注入
            style={{ "--swatch-color": entry.value } as SwatchVars}
            onClick={(e) => {
              e.stopPropagation();
              onPick(entry.value);
            }}
          />
        ))}
      </div>
      {hasOverride ? (
        <button
          type="button"
          className={styles.resetButton}
          onClick={(e) => {
            e.stopPropagation();
            onReset();
          }}
        >
          恢复默认
        </button>
      ) : null}
    </div>
  );
}
