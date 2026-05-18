import styles from "./VideoQcWarnings.module.css";

interface VideoQcWarningsProps {
  warnings: string[];
}

export function VideoQcWarnings({ warnings }: VideoQcWarningsProps) {
  if (warnings.length === 0) return null;

  return (
    <div
      data-testid="video-qc-warnings"
      className={styles.root}
    >
      {warnings.map((w) => (
        <div key={w} className={styles.warning}>
          {w}
        </div>
      ))}
    </div>
  );
}
