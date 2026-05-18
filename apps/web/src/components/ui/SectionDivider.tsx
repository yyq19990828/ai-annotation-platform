import styles from "./SectionDivider.module.css";

interface SectionDividerProps {
  label: string;
  hint?: string;
}

export function SectionDivider({ label, hint }: SectionDividerProps) {
  return (
    <div className={styles.root}>
      <span className={styles.label}>
        {label}
      </span>
      {hint && (
        <span className={styles.hint}>{hint}</span>
      )}
      <span className={styles.line} />
    </div>
  );
}
