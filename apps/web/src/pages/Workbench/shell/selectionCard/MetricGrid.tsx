import type { Metric } from "./geometryMetrics";
import styles from "./MetricGrid.module.css";

export interface MetricGridProps {
  metrics: Metric[];
}

/**
 * v0.16.14 · 2 列紧凑指标网格。label 次要色 11px / value 主色 13px(tabular-nums),
 * hint 跟在 value 后更次要。空数组不渲染(如 3D / 轨迹几何无 2D 指标)。
 */
export function MetricGrid({ metrics }: MetricGridProps) {
  if (metrics.length === 0) return null;
  return (
    <dl className={styles.grid}>
      {metrics.map((m) => (
        <div key={m.label} className={styles.cell}>
          <dt className={styles.label}>{m.label}</dt>
          <dd className={styles.value} title={m.hint ? `${m.value} · ${m.hint}` : m.value}>
            <span className={styles.valueText}>{m.value}</span>
            {m.hint && <span className={styles.hint}>{m.hint}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
