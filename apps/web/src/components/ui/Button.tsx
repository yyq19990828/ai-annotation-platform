import { clsx } from "clsx";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import styles from "./Button.module.css";
import { useElementStyle } from "./useElementStyle";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "ghost" | "ai" | "danger";
  size?: "sm" | "md";
  children: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "default", size = "md", className, children, style: callerStyle, ...props },
  ref,
) {
  const styleRef = useElementStyle(callerStyle, ref);
  return (
    <button
      ref={styleRef}
      className={clsx(
        "btn",
        variant !== "default" && variant,
        size === "sm" && "sm",
        styles.button,
        styles[variant],
        styles[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});
