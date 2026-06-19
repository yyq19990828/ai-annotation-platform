import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { useElementStyle } from "./useElementStyle";

/**
 * Badge —— shadcn / 设计规范适配层(v0.17.1)。
 * 保留原有 `variant/dot` API(调用点零改动);语义色走设计 §2.2 固定调色板(柔底 /10 + 暗色提亮)。
 * 映射见 docs/plans/2026-06-19-v0.17.1-ui-primitives-wave1.md §3.2。
 */
interface BadgeProps {
  variant?: "default" | "success" | "warning" | "danger" | "accent" | "ai" | "outline";
  dot?: boolean;
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

const variantClassNames: Record<NonNullable<BadgeProps["variant"]>, string> = {
  default: "bg-muted text-muted-foreground",
  success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  danger: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  accent: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  ai: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  outline: "border border-border text-foreground",
};

export function Badge({ variant = "default", dot, children, className, style }: BadgeProps) {
  const styleRef = useElementStyle<HTMLSpanElement>(style);
  return (
    <span
      ref={styleRef}
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        variantClassNames[variant],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current opacity-90" />}
      {children}
    </span>
  );
}
