/**
 * v0.14.1 · 邻帧参考框叠加 K 数切换(0=关 / 1 / 3 / 5 / 7)。
 *
 * 3D / 2D 工作台共用:K>0 时拉前后各 K 帧的同 group_id 标注作半透明只读参考框。
 * 当前值由调用方持久化到 workbench preferences。
 */
import styles from "./CrossFrameOverlayToggle.module.css";

const OPTIONS = [0, 1, 3, 5, 7] as const;

export function CrossFrameOverlayToggle({
  value,
  onChange,
}: {
  value: number;
  onChange: (k: number) => void;
}) {
  return (
    <div className={styles.wrap} role="group" aria-label="邻帧叠加">
      <span className={styles.label}>邻帧叠加</span>
      {OPTIONS.map((k) => (
        <button
          key={k}
          type="button"
          className={`${styles.seg} ${value === k ? styles.segActive : ""}`}
          aria-pressed={value === k}
          onClick={() => onChange(k)}
        >
          {k === 0 ? "关" : k}
        </button>
      ))}
    </div>
  );
}
