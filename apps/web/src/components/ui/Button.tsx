import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import { buttonVariants } from "@/components/shadcn/ui/button";
import { cn } from "@/lib/utils";

import { useElementStyle } from "./useElementStyle";

/**
 * Button —— shadcn 适配层(v0.17.1)。
 * 保留原有 `variant/size` API(调用点零改动),内部改走 shadcn 的 `buttonVariants`。
 * 渲染原生 `<button>` 以保留 forwardRef + useElementStyle(`style` 透传,绕 eslint inline-style 禁令)。
 * 映射见 docs/plans/2026-06-19-v0.17.1-ui-primitives-wave1.md §3.1。
 */
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "ghost" | "ai" | "danger";
  size?: "sm" | "md";
  children: ReactNode;
}

// 旧 variant → shadcn variant + 额外语义点缀 className(设计 §2.2)
const VARIANT_MAP: Record<
  NonNullable<ButtonProps["variant"]>,
  { base: "default" | "outline" | "ghost"; extra?: string }
> = {
  default: { base: "outline" },
  primary: { base: "default" },
  ghost: { base: "ghost" },
  ai: {
    base: "outline",
    extra:
      "border-violet-500/30 bg-violet-500/10 text-violet-600 hover:bg-violet-500/15 dark:text-violet-400",
  },
  danger: {
    base: "outline",
    extra:
      "border-rose-500/30 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400",
  },
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "default", size = "md", className, children, style: callerStyle, ...props },
  ref,
) {
  const styleRef = useElementStyle(callerStyle, ref);
  const { base, extra } = VARIANT_MAP[variant];
  return (
    <button
      ref={styleRef}
      className={cn(
        // 迁移期未启用全局 Tailwind preflight(只在 .内重置),而本适配器渲染的原生
        // <button> 被非 的老页面使用 → 否则浏览器 UA 默认按钮样式(灰底 + 2px outset 边)
        // 会透出来。这段基线等价于 preflight 的按钮重置:appearance-none + 透明底 + 0 宽发丝色边框;
        // 各 variant 用 twMerge 覆盖(outline 的 `border` 覆盖宽度、bg-* 覆盖底色)。v0.17.7 转全局
        // preflight 后此基线变冗余但无害。
        "appearance-none border-0 border-border bg-transparent",
        buttonVariants({ variant: base, size: size === "sm" ? "sm" : "default" }),
        "transition-[background-color,border-color,color,box-shadow,transform] duration-200 hover:-translate-y-px active:translate-y-0 active:scale-[0.98]",
        extra,
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});
