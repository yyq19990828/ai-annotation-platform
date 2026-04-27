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
        padding: size === "sm" ? "3px 8px" : "6px 12px",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--color-border)",
        background: variant === "primary" ? "var(--color-accent)" :
          variant === "ai" ? "var(--color-ai-soft)" :
          variant === "ghost" ? "transparent" :
          "var(--color-bg-elev)",
        borderColor: variant === "primary" ? "var(--color-accent)" :
          variant === "ai" ? "oklch(0.85 0.05 295)" :
          variant === "ghost" ? "transparent" :
          "var(--color-border)",
        color: variant === "primary" ? "white" :
          variant === "ai" ? "var(--color-ai)" :
          variant === "danger" ? "var(--color-danger)" :
          "var(--color-fg)",
        fontSize: size === "sm" ? 12 : 13,
        fontWeight: 500,
        whiteSpace: "nowrap" as const,
        cursor: "pointer",
        fontFamily: "inherit",
      }}
      {...props}
    >
      {children}
    </button>
  );
}
