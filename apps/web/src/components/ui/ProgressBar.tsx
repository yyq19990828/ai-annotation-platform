interface ProgressBarProps {
  value: number;
  color?: string;
  aiValue?: number;
  /** v0.6.7：底层「已动工」副条（含 in_progress / review / completed），用淡色背景表示 */
  inProgressValue?: number;
  style?: React.CSSProperties;
}

export function ProgressBar({ value, color = "var(--color-accent)", aiValue, inProgressValue, style }: ProgressBarProps) {
  return (
    <div
      style={{
        position: "relative",
        height: 6,
        background: "var(--color-bg-sunken)",
        borderRadius: 100,
        overflow: "hidden",
        ...style,
      }}
    >
      {/* 第 0 层：已动工（最浅） */}
      {inProgressValue !== undefined && inProgressValue > 0 && (
        <i
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            bottom: 0,
            width: Math.min(100, inProgressValue) + "%",
            background: "var(--color-accent-soft)",
            borderRadius: "inherit",
            transition: "width 0.3s",
          }}
        />
      )}
      {/* 第 1 层：AI 完成（紫色，从左 0 到 aiValue） */}
      {aiValue !== undefined && aiValue > 0 && (
        <i
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            bottom: 0,
            width: aiValue + "%",
            background: "oklch(0.75 0.12 295)",
            borderRadius: "inherit",
          }}
        />
      )}
      {/* 第 2 层：人工完成（accent，从 aiValue 到 value） */}
      <i
        style={{
          position: "absolute",
          top: 0,
          left: aiValue ? aiValue + "%" : 0,
          bottom: 0,
          width: (value - (aiValue || 0)) + "%",
          background: color,
          borderRadius: "inherit",
          transition: "width 0.3s",
        }}
      />
    </div>
  );
}
