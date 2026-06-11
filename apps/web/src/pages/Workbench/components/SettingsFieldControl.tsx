// v0.15.3 · 注册表驱动的共享设置控件:工作台设置抽屉与 Settings 页「标注偏好」共用,
// 按 field.control 类型渲染 toggle / slider / select / text。锁定字段禁用 + 「项目锁定」badge。
import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import type {
  WorkbenchSettingField,
  WorkbenchSettingValue,
} from "../state/workbenchSettingsFields";
import styles from "./SettingsFieldControl.module.css";

const LOCKED_TITLE = "由项目统一配置";

interface SettingsFieldControlProps {
  field: WorkbenchSettingField;
  value: WorkbenchSettingValue;
  /** 保存中临时禁用(toggle/slider/select;text 仅锁定时禁用,与 SettingsPage 既有行为一致)。 */
  disabled?: boolean;
  /** 被项目级 rendering_config 锁定:禁用 + badge + hover 提示。 */
  locked?: boolean;
  onCommit: (value: WorkbenchSettingValue) => void;
}

export function SettingsFieldControl({
  field,
  value,
  disabled = false,
  locked = false,
  onCommit,
}: SettingsFieldControlProps) {
  const { control } = field;
  const baseLabel = field.description
    ? `${field.label}（${field.description}）`
    : field.label;
  const labelText =
    control.type === "slider"
      ? `${baseLabel}：${control.format ? control.format(Number(value)) : String(value)}`
      : baseLabel;

  return (
    <label
      className={styles.field}
      title={locked ? LOCKED_TITLE : undefined}
      data-testid={`setting-field-${field.key}`}
    >
      <div className={styles.label}>
        {labelText}
        {locked && (
          <span className={styles.lockBadge} title={LOCKED_TITLE}>
            <Icon name="lock" size={10} />
            项目锁定
          </span>
        )}
      </div>
      {control.type === "toggle" && (
        <span className={styles.checkLabel}>
          <input
            type="checkbox"
            checked={Boolean(value)}
            disabled={disabled || locked}
            onChange={(e) => onCommit(e.target.checked)}
          />
          {(control.onText || control.offText) && (
            <span>{value ? control.onText : control.offText}</span>
          )}
        </span>
      )}
      {control.type === "slider" && (
        <input
          type="range"
          min={control.min}
          max={control.max}
          step={control.step}
          value={Number(value)}
          disabled={disabled || locked}
          onChange={(e) => onCommit(Number(e.target.value))}
          className={styles.range}
        />
      )}
      {control.type === "select" && (
        <select
          value={String(value)}
          disabled={disabled || locked}
          onChange={(e) => onCommit(e.target.value)}
          className={styles.input}
        >
          {control.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      )}
      {control.type === "text" && (
        <TextControl
          value={String(value)}
          maxLength={control.maxLength}
          placeholder={control.placeholder}
          disabled={locked}
          onCommit={onCommit}
        />
      )}
    </label>
  );
}

/** text 控件本地暂存,blur 时 trim 后提交(沿用 SettingsPage cssImageFilter 既有交互)。 */
function TextControl({
  value,
  maxLength,
  placeholder,
  disabled,
  onCommit,
}: {
  value: string;
  maxLength: number;
  placeholder?: string;
  disabled: boolean;
  onCommit: (value: string) => void;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => {
    setLocal(value);
  }, [value]);

  return (
    <input
      value={local}
      disabled={disabled}
      onChange={(e) => setLocal(e.target.value.slice(0, maxLength))}
      onBlur={() => {
        if (local !== value) onCommit(local.trim());
      }}
      placeholder={placeholder}
      className={styles.input}
    />
  );
}
