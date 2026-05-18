import { clsx } from "clsx";
import type { ReactNode } from "react";

import styles from "./Badge.module.css";
import { useElementStyle } from "./useElementStyle";

interface BadgeProps {
  variant?: "default" | "success" | "warning" | "danger" | "accent" | "ai" | "outline";
  dot?: boolean;
  children: ReactNode;
  style?: React.CSSProperties;
}

const variantClassNames: Record<NonNullable<BadgeProps["variant"]>, string> = {
  default: styles.default,
  success: styles.success,
  warning: styles.warning,
  danger: styles.danger,
  accent: styles.accent,
  ai: styles.ai,
  outline: styles.outline,
};

export function Badge({ variant = "default", dot, children, style }: BadgeProps) {
  const styleRef = useElementStyle<HTMLSpanElement>(style);
  return (
    <span ref={styleRef} className={clsx(styles.badge, variantClassNames[variant])}>
      {dot && <span className={styles.dot} />}
      {children}
    </span>
  );
}
