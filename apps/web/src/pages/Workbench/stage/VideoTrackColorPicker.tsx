import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { useElementStyle } from "@/components/ui/useElementStyle";
import { TRACK_COLOR_PALETTE } from "./colors";

interface VideoTrackColorPickerProps {
  /** 当前生效色（用于高亮选中的色块）。 */
  currentColor: string;
  /** 是否存在覆盖色（决定是否显示「恢复默认」）。 */
  hasOverride: boolean;
  onPick: (color: string) => void;
  onReset: () => void;
  onClose: () => void;
}

function SwatchButton({
  color,
  label,
  active,
  onPick,
}: {
  color: string;
  label: string;
  active: boolean;
  onPick: (color: string) => void;
}) {
  const ref = useElementStyle<HTMLButtonElement>({ backgroundColor: color } as CSSProperties);
  return (
    <button
      ref={ref}
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`w-[18px] h-[18px] p-0 border border-border rounded cursor-pointer hover:border-foreground/20 ${active ? "border-brand shadow-[0_0_0_1px_var(--sc-brand)]" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        onPick(color);
      }}
    />
  );
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
    <div ref={rootRef} className="flex flex-col gap-1.5 p-1.5 bg-card border border-border rounded-md shadow-lg" role="dialog" aria-label="选择轨迹颜色">
      <div className="grid grid-cols-4 gap-1">
        {TRACK_COLOR_PALETTE.map((entry) => (
          <SwatchButton
            key={entry.value}
            color={entry.value}
            label={entry.label}
            active={entry.value === currentColor}
            onPick={onPick}
          />
        ))}
      </div>
      {hasOverride ? (
        <button
          type="button"
          className="py-0.5 px-1.5 text-xs text-muted-foreground bg-transparent border border-border rounded cursor-pointer hover:text-foreground hover:bg-muted"
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
