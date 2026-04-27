interface ProgressBarProps {
  value: number;
  color?: string;
  aiValue?: number;
  style?: React.CSSProperties;
}

export function ProgressBar({ value, color = "var(--color-accent)", aiValue, style }: ProgressBarProps) {
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
