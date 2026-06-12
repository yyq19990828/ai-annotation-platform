/**
 * v0.14.1 · 邻帧参考框叠加 K 数切换(1 / 3 / 5 / 7)。
 * v0.15.17 · 增「范围」切换(对象/全部)+ 无 ego 轨迹常驻降级 badge。
 * v0.15.19 · 关闭从 K=0 拆为独立开关,帧数与范围单独设置。
 *
 * 3D / 2D 工作台共用:enabled 时拉前后各 K 帧的标注作半透明只读参考框。
 * 当前值由调用方持久化到 workbench preferences。
 */
import styles from "./CrossFrameOverlayToggle.module.css";

const OPTIONS = [1, 3, 5, 7] as const;

export function CrossFrameOverlayToggle({
  enabled,
  onEnabledChange,
  value,
  onChange,
  scope,
  onScopeChange,
  noPose = false,
}: {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  value: number;
  onChange: (k: number) => void;
  /** v0.15.17 · 叠加范围;省略则不渲染范围切换(视频侧暂不需要)。 */
  scope?: "selected" | "all";
  onScopeChange?: (s: "selected" | "all") => void;
  /** v0.15.17 · 该 scene 无 ego 轨迹 → 邻帧框未对齐,常驻提示。 */
  noPose?: boolean;
}) {
  return (
    <div className={styles.wrap} role="group" aria-label="邻帧框叠加">
      <span className={styles.label}>邻帧框叠加</span>
      <button
        type="button"
        className={`${styles.seg} ${enabled ? styles.segActive : ""}`}
        aria-pressed={enabled}
        onClick={() => onEnabledChange(!enabled)}
      >
        {enabled ? "开" : "关"}
      </button>
      {OPTIONS.map((k) => (
        <button
          key={k}
          type="button"
          className={`${styles.seg} ${value === k ? styles.segActive : ""}`}
          aria-pressed={value === k}
          disabled={!enabled}
          onClick={() => onChange(k)}
        >
          {k}
        </button>
      ))}
      {enabled && scope && onScopeChange && (
        <span className={styles.scope} role="group" aria-label="叠加范围">
          <button
            type="button"
            className={`${styles.seg} ${scope === "selected" ? styles.segActive : ""}`}
            aria-pressed={scope === "selected"}
            onClick={() => onScopeChange("selected")}
          >
            对象
          </button>
          <button
            type="button"
            className={`${styles.seg} ${scope === "all" ? styles.segActive : ""}`}
            aria-pressed={scope === "all"}
            onClick={() => onScopeChange("all")}
          >
            全部
          </button>
        </span>
      )}
      {enabled && noPose && (
        <span
          className={styles.badge}
          title="该 scene 无 ego 轨迹,邻帧框按原样叠加,未做运动对齐"
        >
          无 ego 轨迹·未对齐
        </span>
      )}
    </div>
  );
}
