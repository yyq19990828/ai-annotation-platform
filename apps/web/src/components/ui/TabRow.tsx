import styles from "./TabRow.module.css";

interface TabRowProps {
  tabs: string[];
  active: string;
  onChange: (tab: string) => void;
}

export function TabRow({ tabs, active, onChange }: TabRowProps) {
  return (
    <div className={styles.root}>
      {tabs.map(t => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className={`${styles.tab} ${active === t ? styles.active : ""}`}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
