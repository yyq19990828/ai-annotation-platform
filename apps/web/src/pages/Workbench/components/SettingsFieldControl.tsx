// v0.15.3 · 注册表驱动的共享设置控件:工作台设置抽屉与 Settings 页「标注偏好」共用,
// 按 field.control 类型渲染 toggle / slider / select / text。锁定字段禁用 + 「项目锁定」badge。
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Switch } from "@/components/ui/Switch";
import type {
  WorkbenchSettingField,
  WorkbenchSettingValue,
} from "../state/workbenchSettingsFields";
import styles from "./SettingsFieldControl.module.css";

const LOCKED_TITLE = "由项目统一配置";

interface SettingsFieldControlProps {
  field: WorkbenchSettingField;
  value: WorkbenchSettingValue;
  /** 父开关下的二级设置。 */
  nested?: boolean;
  /** 保存中临时禁用(toggle/slider/select;text 仅锁定时禁用,与 SettingsPage 既有行为一致)。 */
  disabled?: boolean;
  /** 被项目级 rendering_config 锁定:禁用 + badge + hover 提示。 */
  locked?: boolean;
  onCommit: (value: WorkbenchSettingValue) => void;
}

export function SettingsFieldControl({
  field,
  value,
  nested = false,
  disabled = false,
  locked = false,
  onCommit,
}: SettingsFieldControlProps) {
  const { control } = field;
  // 滑块拖动期间用实时值显示数字(commit 仍只在松手发生);value 提交后经 effect 回同步。
  const [sliderLive, setSliderLive] = useState(Number(value));
  useEffect(() => {
    setSliderLive(Number(value));
  }, [value]);
  const labelText =
    control.type === "slider"
      ? `${field.label}：${control.format ? control.format(sliderLive) : String(sliderLive)}`
      : field.label;
  const title = locked ? LOCKED_TITLE : field.description;

  return (
    <label
      className={`${styles.field} ${nested ? styles.fieldNested : ""} ${
        disabled && !locked ? styles.fieldDisabled : ""
      }`}
      title={title}
      aria-disabled={disabled || locked}
      data-testid={`setting-field-${field.key}`}
    >
      <div className={styles.label}>
        {labelText}
        {field.description && !locked && (
          <span className={styles.helpIcon} aria-label={field.description} title={field.description}>
            <Icon name="info" size={11} />
          </span>
        )}
        {locked && (
          <span className={styles.lockBadge} title={LOCKED_TITLE}>
            <Icon name="lock" size={10} />
            项目锁定
          </span>
        )}
      </div>
      {control.type === "toggle" && (
        <span className={styles.toggleWrap}>
          <Switch
            checked={Boolean(value)}
            disabled={disabled || locked}
            onChange={onCommit}
          />
          {(control.onText || control.offText) && (
            <span className={styles.toggleLabel}>{value ? control.onText : control.offText}</span>
          )}
        </span>
      )}
      {control.type === "slider" && (
        <span className={styles.sliderWrap}>
          <SliderControl
            value={Number(value)}
            min={control.min}
            max={control.max}
            step={control.step}
            disabled={disabled || locked}
            onLiveChange={setSliderLive}
            onCommit={onCommit}
          />
          {control.resetTo !== undefined && (
            <button
              type="button"
              className={styles.resetBtn}
              disabled={disabled || locked}
              onClick={() => onCommit(control.resetTo!)}
            >
              重置
            </button>
          )}
        </span>
      )}
      {control.type === "select" && (
        <select
          value={String(value)}
          disabled={disabled || locked}
          onChange={(e) => {
            const selected = control.options.find(
              (opt) => String(opt.value) === e.target.value,
            );
            if (selected) onCommit(selected.value);
          }}
          className={styles.input}
        >
          {control.options.map((opt) => (
            <option key={String(opt.value)} value={String(opt.value)}>
              {opt.label}
            </option>
          ))}
        </select>
      )}
      {control.type === "multiselect" && (
        <MultiselectControl
          value={Array.isArray(value) ? value : []}
          options={control.options}
          min={control.min ?? 0}
          disabled={disabled || locked}
          onCommit={onCommit}
        />
      )}
      {control.type === "text" && (
        <TextControl
          value={String(value)}
          maxLength={control.maxLength}
          placeholder={control.placeholder}
          disabled={disabled || locked}
          onCommit={onCommit}
        />
      )}
    </label>
  );
}

/** v0.15.27 · 多选 chips:点击切换;受 min 约束时已是最后一项的取消被拒绝(保序提交)。 */
function MultiselectControl({
  value,
  options,
  min,
  disabled,
  onCommit,
}: {
  value: string[];
  options: Array<{ value: string; label: string }>;
  min: number;
  disabled: boolean;
  onCommit: (value: string[]) => void;
}) {
  const selected = new Set(value);
  const toggle = (optValue: string) => {
    const isOn = selected.has(optValue);
    if (isOn && value.length <= min) return; // min 兜底:不允许低于下限
    // 按 options 顺序重建,保证提交值稳定有序。
    const next = options
      .map((o) => o.value)
      .filter((v) => (v === optValue ? !isOn : selected.has(v)));
    onCommit(next);
  };
  return (
    <span className={styles.multiselectWrap} role="group">
      {options.map((opt) => {
        const on = selected.has(opt.value);
        const atFloor = on && value.length <= min;
        return (
          <button
            key={opt.value}
            type="button"
            className={`${styles.chip} ${on ? styles.chipOn : ""}`}
            // chips 嵌在字段 <label> 内,显式 aria-label 兜底可达名,避免名被父 label 文本污染。
            aria-label={opt.label}
            aria-pressed={on}
            disabled={disabled || atFloor}
            onClick={(e) => {
              e.preventDefault();
              toggle(opt.value);
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </span>
  );
}

function SliderControl({
  value,
  min,
  max,
  step,
  disabled,
  onLiveChange,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  /** 拖动过程中每帧上报实时值(供父组件实时显示数字);不触发 commit。 */
  onLiveChange: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  const [local, setLocal] = useState(value);
  const localRef = useRef(value);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) {
      setLocal(value);
      localRef.current = value;
    }
  }, [dragging, value]);

  const commit = () => {
    setDragging(false);
    if (localRef.current !== value) onCommit(localRef.current);
  };

  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={local}
      disabled={disabled}
      onPointerDown={() => setDragging(true)}
      onChange={(e) => {
        const next = Number(e.target.value);
        localRef.current = next;
        setLocal(next);
        onLiveChange(next);
      }}
      onPointerUp={commit}
      onBlur={commit}
      onKeyUp={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") {
          commit();
        }
      }}
      className={styles.range}
    />
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
