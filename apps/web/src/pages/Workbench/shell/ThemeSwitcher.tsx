import { useTheme, type ThemePref } from "@/hooks/useTheme";

const OPTIONS: { value: ThemePref; label: string }[] = [
  { value: "light",  label: "亮色" },
  { value: "dark",   label: "暗色" },
  { value: "system", label: "跟随系统" },
];

/**
 * 主题切换控件（嵌入 Topbar 溢出菜单）。
 * 三档：light / dark / system；偏好持久化到 localStorage。
 */
export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  return (
    <div style={{ padding: "6px 10px", borderTop: "1px solid var(--color-border)", marginTop: 4 }}>
      <div style={{ fontSize: 11, color: "var(--color-fg-subtle)", marginBottom: 4 }}>主题</div>
      <div style={{ display: "flex", gap: 4 }}>
        {OPTIONS.map((opt) => {
          const active = theme === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setTheme(opt.value)}
              aria-pressed={active}
              style={{
                flex: 1, padding: "4px 6px",
                fontSize: 11,
                background: active ? "var(--color-accent-soft)" : "var(--color-bg-sunken)",
                color: active ? "var(--color-accent-fg)" : "var(--color-fg-muted)",
                border: active ? "1px solid var(--color-accent)" : "1px solid var(--color-border)",
                borderRadius: 3,
                cursor: "pointer",
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
