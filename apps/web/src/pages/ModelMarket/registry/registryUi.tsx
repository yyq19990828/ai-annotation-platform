/**
 * v0.23.4 P3 · tiny shared presentational helpers used by every registry
 * section. Kept in one file to avoid a sprawl of one-off micro-components
 * (plan §10: "不为每个字段创建组件").
 */
import { useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/ui/tooltip";

import { copyToClipboard } from "./registryShared";

/** A monospace id with a copy button and a tooltip exposing the full value. */
export function CopyableId({
  value,
  className,
  label,
}: {
  value: string;
  className?: string;
  label?: string;
}): ReactNode {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    const ok = await copyToClipboard(value);
    setCopied(ok);
    if (ok) window.setTimeout(() => setCopied(false), 1200);
  };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onCopy}
          className={
            "inline-flex max-w-[180px] items-center gap-1 text-xs text-muted-foreground " +
            (className ?? "")
          }
          title={label ? `${label} · 点击复制` : "点击复制"}
        >
          <span className="mono truncate">{value}</span>
          <Icon name={copied ? "check" : "copy"} size={11} />
        </button>
      </TooltipTrigger>
      <TooltipContent>{value}</TooltipContent>
    </Tooltip>
  );
}

/** Inline "未声明" / "—" sentinel. */
export function NullCell({ children = "—" }: { children?: ReactNode }): ReactNode {
  return <span className="text-xs text-muted-foreground">{children}</span>;
}

/** Loading placeholder used inside section bodies. */
export function LoadingState({ label = "加载中…" }: { label?: string }): ReactNode {
  return (
    <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
      <Icon name="loader2" size={14} className="spin" />
      {label}
    </div>
  );
}

/** Empty-state block with an icon + message + optional hint. */
export function EmptyState({
  icon = "bot",
  message,
  hint,
}: {
  icon?: Parameters<typeof Icon>[0]["name"];
  message: string;
  hint?: string;
}): ReactNode {
  return (
    <div className="flex flex-col items-center gap-1 p-8 text-center text-sm text-muted-foreground">
      <Icon name={icon} size={28} className="opacity-25" />
      <div>{message}</div>
      {hint && <div className="text-xs">{hint}</div>}
    </div>
  );
}

/** Error block with a retry button — partial failures must not nuke the page. */
export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}): ReactNode {
  return (
    <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-status-danger">
      <Icon name="warning" size={18} />
      <div>{message}</div>
      {onRetry && (
        <Button size="sm" variant="ghost" onClick={onRetry}>
          <Icon name="refresh" size={11} />
          重试
        </Button>
      )}
    </div>
  );
}

/** A compact "N 个受影响" chip used by Issue Center / pool / GPU rows. */
export function AffectedCountChip({ count }: { count: number }): ReactNode {
  if (count <= 0) return null;
  return (
    <Badge variant="outline" className="text-2xs">
      影响 {count}
    </Badge>
  );
}
