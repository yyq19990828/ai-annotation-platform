import { cn } from "@/lib/utils";

import { Icon, type IconName } from "./Icon";
import { Sparkline } from "./Sparkline";

/**
 * StatCard —— 统计卡(v0.17.2,module.css → Tailwind)。
 * 保持原布局(图标-左 + 标签 + 数值 + trend + sparkline),仅 token 化:中性卡 + 发丝边,
 * trend 走设计 §2.2 emerald/rose。更丰富的「彩色图标片」范式留待 Dashboard 迁移(v0.17.3)。
 */
interface StatCardProps {
  icon?: IconName;
  label: string;
  value: string | number;
  trend?: number;
  sparkValues?: number[];
  sparkColor?: string;
  hint?: string;
}

export function StatCard({ icon, label, value, trend, sparkValues, sparkColor, hint }: StatCardProps) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3.5">
      <div className="mb-2 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        {icon && <Icon name={icon} size={13} className="shrink-0" />}
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{label}</span>
        {hint && <span className="ml-auto shrink-0 whitespace-nowrap text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      <div>
        <span className="text-2xl font-semibold tabular-nums">
          {typeof value === "number" ? value.toLocaleString() : value}
        </span>
        {trend !== undefined && (
          <span
            className={cn(
              "ml-1.5 text-[11px] font-medium tabular-nums",
              trend >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400",
            )}
          >
            {trend >= 0 ? "↑" : "↓"} {Math.abs(trend)}%
          </span>
        )}
      </div>
      {sparkValues && (
        <div className="mt-2 h-7">
          <Sparkline values={sparkValues} color={sparkColor} width={240} />
        </div>
      )}
    </div>
  );
}
