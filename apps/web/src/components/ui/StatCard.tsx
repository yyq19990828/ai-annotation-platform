import { Icon, type IconName } from "./Icon";
import { Sparkline } from "./Sparkline";
import styles from "./StatCard.module.css";

interface StatCardProps {
  icon?: IconName;
  label: string;
  value: string | number;
  trend?: number;
  sparkValues?: number[];
  sparkColor?: string;
  hint?: string;
}

export function StatCard({ icon, label, value, trend, sparkValues, sparkColor, hint }: StatCardProps) {
  return (
    <div className={styles.root}>
      <div className={styles.header}>
        {icon && <Icon name={icon} size={13} className={styles.icon} />}
        <span className={styles.label}>
          {label}
        </span>
        {hint && (
          <span className={styles.hint}>
            {hint}
          </span>
        )}
      </div>
      <div>
        <span className={styles.value}>
          {typeof value === "number" ? value.toLocaleString() : value}
        </span>
        {trend !== undefined && (
          <span className={`${styles.trend} ${trend >= 0 ? styles.trendPositive : styles.trendNegative}`}>
            {trend >= 0 ? "↑" : "↓"} {Math.abs(trend)}%
          </span>
        )}
      </div>
      {sparkValues && (
        <div className={styles.sparkline}>
          <Sparkline values={sparkValues} color={sparkColor} width={240} />
        </div>
      )}
    </div>
  );
}
