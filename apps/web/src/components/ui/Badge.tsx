import type { ReactNode } from "react";

interface BadgeProps {
  variant?: "default" | "success" | "warning" | "danger" | "accent" | "ai" | "outline";
  dot?: boolean;
  children: ReactNode;
  style?: React.CSSProperties;
}

const variantStyles: Record<string, React.CSSProperties> = {
  default: { background: "var(--color-bg-sunken)", color: "var(--color-fg-muted)" },
  success: { background: "var(--color-success-soft)", color: "var(--color-success)" },
  warning: { background: "var(--color-warning-soft)", color: "var(--color-warning)" },
  danger: { background: "var(--color-danger-soft)", color: "var(--color-danger)" },
  accent: { background: "var(--color-accent-soft)", color: "var(--color-accent-fg)" },
  ai: { background: "var(--color-ai-soft)", color: "var(--color-ai)" },
  outline: { background: "transparent", border: "1px solid var(--color-border)" },
};

export function Badge({ variant = "default", dot, children, style }: BadgeProps) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 100,
        fontSize: 11,
        fontWeight: 500,
        whiteSpace: "nowrap" as const,
        ...variantStyles[variant],
        ...style,
      }}
    >
      {dot && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "currentColor",
            opacity: 0.9,
          }}
        />
      )}
      {children}
    </span>
  );
}
