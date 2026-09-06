import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * 标准页面容器：所有带页头（标题 + 操作按钮）的滚动页共用，
 * 统一内容区宽度与左右留白，保证路由间切换时页面边界对齐。
 *
 * 全高工作台页面（Workbench / Review / 数据管理器）有独立布局，不使用此容器。
 */
export function PageContainer({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[1480px] px-7 pb-10 pt-5 text-foreground max-[900px]:px-4 max-[900px]:pb-6 max-[900px]:pt-4",
        className,
      )}
      {...rest}
    />
  );
}
