/**
 * SectionDivider —— 分区标题分隔(v0.17.2,module.css → Tailwind)。
 */
interface SectionDividerProps {
  label: string;
  hint?: string;
}

export function SectionDivider({ label, hint }: SectionDividerProps) {
  return (
    <div className="mb-2 mt-5 flex items-center gap-2.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </span>
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
