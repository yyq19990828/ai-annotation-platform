import { clsx } from "clsx";
import styles from "./Switch.module.css";

interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** 开关右侧文案；省略则只渲染开关本体。 */
  label?: string;
  title?: string;
  "data-testid"?: string;
}

/**
 * 苹果风格开关。视觉沿用 Topbar / AttributeForm 的 switchTrack / switchKnob
 * 规范（accent 轨道 + bg-elev 滑块，明暗同源）。保留真实 checkbox 以保证
 * label 关联与键盘可达。
 */
export function Switch({
  checked,
  onChange,
  disabled = false,
  label,
  title,
  "data-testid": testId,
}: SwitchProps) {
  const control = (
    <span className={styles.switch}>
      <input
        type="checkbox"
        role="switch"
        className={styles.switchInput}
        checked={checked}
        disabled={disabled}
        title={title}
        onChange={(e) => onChange(e.target.checked)}
        data-testid={testId}
      />
      <span className={clsx(styles.switchTrack, checked && styles.switchTrackOn)}>
        <span className={styles.switchKnob} />
      </span>
    </span>
  );
  if (label === undefined) return control;
  return (
    <label className={clsx(styles.wrap, disabled && styles.wrapDisabled)}>
      {control}
      <span className={styles.label}>{label}</span>
    </label>
  );
}
