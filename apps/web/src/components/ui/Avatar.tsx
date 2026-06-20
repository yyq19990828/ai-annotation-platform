import { cn } from "@/lib/utils";

import { useElementStyle } from "./useElementStyle";

/**
 * Avatar —— 首字母头像(v0.17.2)。
 * 纯首字母(无图片加载),故不用 shadcn `<Avatar>` 的图片回退机制,直接渲染中性圆片
 * (设计「中性基底」:`bg-muted`)。保留 `style` 透传(useElementStyle),调用方仍可覆盖配色。
 */
interface AvatarProps {
  initial: string;
  size?: "sm" | "md" | "lg";
  style?: React.CSSProperties;
}

const sizeClassNames: Record<NonNullable<AvatarProps["size"]>, string> = {
  sm: "size-5 text-2xs",
  md: "size-7 text-xs",
  lg: "size-9 text-sm",
};

export function Avatar({ initial, size = "sm", style }: AvatarProps) {
  const styleRef = useElementStyle<HTMLDivElement>(style);
  return (
    <div
      ref={styleRef}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full bg-muted font-semibold text-foreground",
        sizeClassNames[size],
      )}
    >
      {initial}
    </div>
  );
}
