import { forwardRef, useId, type ComponentPropsWithoutRef } from "react";

import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";

type FilterTriggerProps = Omit<ComponentPropsWithoutRef<typeof Button>, "children"> & {
  children?: React.ReactNode;
  count?: number;
  countLabel?: string;
  compact?: boolean;
};

export const FilterTrigger = forwardRef<HTMLButtonElement, FilterTriggerProps>(
  function FilterTrigger(
    {
      children = "筛选",
      count = 0,
      countLabel = "筛选条件",
      compact = false,
      size = compact ? "xs" : "sm",
      className,
      "aria-describedby": describedBy,
      ...props
    },
    ref,
  ) {
    const descriptionId = useId();
    const active = count > 0;
    return (
      <Button
        ref={ref}
        type="button"
        size={size}
        data-filter-trigger=""
        data-active={active}
        aria-describedby={
          [describedBy, active && descriptionId].filter(Boolean).join(" ") || undefined
        }
        className={cn(
          "gap-1.5 hover:translate-y-0 active:scale-100 data-[state=open]:bg-accent data-[state=open]:border-ring/40",
          active && "border-brand/30 bg-brand/5 text-brand hover:bg-brand/10 hover:text-brand",
          className,
        )}
        {...props}
      >
        <Icon name="filter" className={compact ? "size-3" : "size-4"} />
        {children}
        {active && (
          <>
            <span
              aria-hidden="true"
              className="inline-flex h-4 min-w-4 items-center justify-center rounded-sm bg-brand/10 px-1 text-2xs tabular-nums text-brand"
            >
              {count}
            </span>
            <span id={descriptionId} hidden>
              {count} 项{countLabel}
            </span>
          </>
        )}
      </Button>
    );
  },
);
