import { clsx } from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "ghost" | "ai" | "danger";
  size?: "sm" | "md";
  children: ReactNode;
}

export function Button({ variant = "default", size = "md", className, children, ...props }: ButtonProps) {
  return (
    <button
      className={clsx("btn", variant !== "default" && variant, size === "sm" && "sm", className)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: size === "sm" ? "3px 10px" : "6px 14px",
        borderRadius: size === "sm" ? "var(--radius-pill)" : "var(--radius-lg)",
        border: "1px solid var(--color-border)",
        background: variant === "primary" ? "var(--color-accent)" :
          variant === "ai" ? "var(--color-ai-soft)" :
          variant === "ghost" ? "transparent" :
          "var(--color-bg-elev)",
        borderColor: variant === "primary" ? "var(--color-accent)" :
          variant === "ai" ? "oklch(0.85 0.05 295)" :
          variant === "ghost" ? "transparent" :
          variant === "danger" ? "oklch(0.88 0.06 25)" :
          "var(--color-border)",
        color: variant === "primary" ? "white" :
          variant === "ai" ? "var(--color-ai)" :
          variant === "danger" ? "var(--color-danger)" :
          "var(--color-fg)",
        boxShadow: variant === "primary" ? "0 1px 3px oklch(0.55 0.18 252 / 0.25)" :
          variant === "ghost" ? "none" :
          "var(--shadow-sm)",
        fontSize: size === "sm" ? 12 : 13,
        fontWeight: 500,
        whiteSpace: "nowrap" as const,
        cursor: "pointer",
        fontFamily: "inherit",
        transition: "opacity 0.1s",
      }}
      {...props}
    >
      {children}
    </button>
  );
}
