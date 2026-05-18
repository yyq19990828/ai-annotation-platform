import styles from "./RadialProgress.module.css";

interface RadialProgressProps {
  value: number;
  max?: number;
  size?: number;
  thickness?: number;
  color?: string;
  trackColor?: string;
  label?: string;
}

/**
 * v0.8.4 · 圆环进度（综合分等）。SVG 单环，不引图表库。
 */
export function RadialProgress({
  value,
  max = 100,
  size = 56,
  thickness = 6,
  color = "var(--color-accent)",
  trackColor = "var(--color-border)",
  label,
}: RadialProgressProps) {
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.min(1, Math.max(0, value / max));
  const dashLen = c * pct;
  return (
    <div className={styles.root}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={trackColor} strokeWidth={thickness} />
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={`${dashLen} ${c - dashLen}`}
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      </svg>
      <div className={`${styles.center} ${size > 80 ? styles.centerLarge : styles.centerCompact}`}>
        <span>{Math.round(value)}</span>
        {label && (
          <span className={styles.label}>
            {label}
          </span>
        )}
      </div>
    </div>
  );
}
