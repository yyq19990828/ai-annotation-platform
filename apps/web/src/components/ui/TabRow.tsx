import { cn } from "@/lib/utils";

/**
 * TabRow —— 筛选标签行(v0.17.2,module.css → Tailwind)。
 * 这是「筛选行」(各 tab 内容由调用方自管,无 tabpanel),故用语义化按钮组而非 Radix Tabs
 * (无 panel 的 role=tab 是 a11y 反模式)。`{tabs,active,onChange}` API 不变,调用点零改动。
 */
interface TabRowProps {
  tabs: string[];
  active: string;
  onChange: (tab: string) => void;
}

export function TabRow({ tabs, active, onChange }: TabRowProps) {
  return (
    <div className="inline-flex items-center gap-1">
      {tabs.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(t)}
          className={cn(
            // 迁移期无全局 preflight,原生 <button> 在非 .页面会漏出 UA 默认灰底+粗边
            // (同 Button 适配器基线);v0.17.7 preflight 转全局后此基线变冗余但无害。
            "appearance-none border-0 bg-transparent rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            active === t
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
