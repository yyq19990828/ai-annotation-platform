import { useTheme, type ThemePref } from "@/hooks/useTheme";
import styles from "./ThemeSwitcher.module.css";

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
    <div className={styles.root}>
      <div className={styles.label}>主题</div>
      <div className={styles.options}>
        {OPTIONS.map((opt) => {
          const active = theme === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setTheme(opt.value)}
              aria-pressed={active}
              className={active ? styles.optionActive : styles.option}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
