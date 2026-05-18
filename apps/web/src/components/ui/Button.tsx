import { clsx } from "clsx";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import styles from "./Button.module.css";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "ghost" | "ai" | "danger";
  size?: "sm" | "md";
  children: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "default", size = "md", className, children, style: callerStyle, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={clsx(
        "btn",
        variant !== "default" && variant,
        size === "sm" && "sm",
        styles.button,
        styles[variant],
        styles[size],
        className,
      )}
      style={callerStyle}
      {...props}
    >
      {children}
    </button>
  );
});
