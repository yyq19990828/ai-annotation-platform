import { Icon, type IconName } from "./Icon";
import { Sparkline } from "./Sparkline";

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
    <div
      style={{
        padding: "14px 16px",
        background: "var(--color-bg-elev)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-lg)",
      }}
    >
      <div
        style={{
          fontSize: 12,
          color: "var(--color-fg-muted)",
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 8,
          minWidth: 0,
        }}
      >
        {icon && <Icon name={icon} size={13} style={{ flexShrink: 0 }} />}
        <span
          style={{
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            minWidth: 0,
          }}
        >
          {label}
        </span>
        {hint && (
          <span
            style={{
              marginLeft: "auto",
              color: "var(--color-fg-subtle)",
              fontSize: 11,
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {hint}
          </span>
        )}
      </div>
      <div>
        <span
          style={{
            fontSize: 24,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {typeof value === "number" ? value.toLocaleString() : value}
        </span>
        {trend !== undefined && (
          <span
            style={{
              fontSize: 11,
              marginLeft: 6,
              fontWeight: 500,
              fontVariantNumeric: "tabular-nums",
              color: trend >= 0 ? "var(--color-success)" : "var(--color-danger)",
            }}
          >
            {trend >= 0 ? "↑" : "↓"} {Math.abs(trend)}%
          </span>
        )}
      </div>
      {sparkValues && (
        <div style={{ marginTop: 8, height: 28 }}>
          <Sparkline values={sparkValues} color={sparkColor} width={240} />
        </div>
      )}
    </div>
  );
}
