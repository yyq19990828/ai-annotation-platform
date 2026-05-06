interface HistogramProps {
  values: number[];
  height?: number;
  color?: string;
  /** 可选：在某 index 处渲染竖向标注线（如 p50 / p95） */
  markers?: Array<{ index: number; label: string }>;
  /** 横轴标签（可选，长度需与 values 一致） */
  xLabels?: string[];
}

/**
 * v0.8.4 · 直方图（任务耗时分布、24-bar 专注时段等）。
 * 仿 RegistrationSourceCard 的 stacked-bar 风格，flex 容器 + 动态 % 高度。
 */
export function Histogram({
  values,
  height = 80,
  color = "var(--color-accent)",
  markers = [],
  xLabels,
}: HistogramProps) {
  const peak = Math.max(1, ...values);
  return (
    <div>
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "flex-end",
          gap: 2,
          height,
        }}
      >
        {values.map((v, i) => {
          const h = Math.max(1, (v / peak) * height);
          return (
            <div
              key={i}
              title={xLabels?.[i] ? `${xLabels[i]}: ${v}` : String(v)}
              style={{
                flex: 1,
                height: h,
                background: color,
                borderRadius: "2px 2px 0 0",
                minHeight: 1,
              }}
            />
          );
        })}
        {markers.map((m) => {
          const left = `${(m.index / Math.max(1, values.length - 1)) * 100}%`;
          return (
            <div
              key={m.label}
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left,
                width: 1,
                background: "var(--color-fg-subtle)",
                pointerEvents: "none",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: -14,
                  left: 4,
                  fontSize: 10,
                  color: "var(--color-fg-muted)",
                  whiteSpace: "nowrap",
                }}
              >
                {m.label}
              </span>
            </div>
          );
        })}
      </div>
      {xLabels && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 4,
            fontSize: 10,
            color: "var(--color-fg-subtle)",
          }}
        >
          <span>{xLabels[0]}</span>
          <span>{xLabels[xLabels.length - 1]}</span>
        </div>
      )}
    </div>
  );
}
