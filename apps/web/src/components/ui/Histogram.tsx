import styles from "./Histogram.module.css";

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
    <div className={styles.root}>
      <div
        ref={(element) => {
          if (!element) return;
          element.style.height = `${height}px`;
        }}
        className={styles.bars}
      >
        {values.map((v, i) => {
          const h = Math.max(1, (v / peak) * height);
          return (
            <div
              key={i}
              title={xLabels?.[i] ? `${xLabels[i]}: ${v}` : String(v)}
              ref={(element) => {
                if (!element) return;
                element.style.height = `${h}px`;
                element.style.background = color;
                element.style.borderRadius = "2px 2px 0 0";
                element.style.minHeight = "1px";
              }}
              className={styles.bar}
            />
          );
        })}
        {markers.map((m) => {
          const left = `${(m.index / Math.max(1, values.length - 1)) * 100}%`;
          return (
            <div
              key={m.label}
              ref={(element) => {
                if (!element) return;
                element.style.left = left;
              }}
              className={styles.marker}
            >
              <span className={styles.markerLabel}>
                {m.label}
              </span>
            </div>
          );
        })}
      </div>
      {xLabels && (
        <div className={styles.axis}>
          <span>{xLabels[0]}</span>
          <span>{xLabels[xLabels.length - 1]}</span>
        </div>
      )}
    </div>
  );
}
