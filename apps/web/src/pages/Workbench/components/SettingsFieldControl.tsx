// v0.15.3 · 注册表驱动的共享设置控件:工作台设置抽屉与 Settings 页「标注偏好」共用,
// 按 field.control 类型渲染 toggle / slider / select / text。锁定字段禁用 + 「项目锁定」badge。
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Switch } from "@/components/ui/Switch";
import type { LabelContentByType } from "@/api/auth";
import type {
  WorkbenchSettingField,
  WorkbenchSettingValue,
} from "../state/workbenchSettingsFields";

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
  // labelContentByType 是复杂分段控件,根用 div + 竖排(避免外层 label 包裹多个 input 误触)。
  const isColumn = control.type === "labelContentByType";
  const Root = isColumn ? "div" : "label";

  return (
    <Root
      className={`flex items-center justify-between gap-3 box-border min-h-[38px] px-2.5 py-2 rounded-[var(--radius-sm)] transition-[background] duration-150 hover:bg-muted ${isColumn ? "flex-col items-stretch gap-2" : ""} ${nested ? "ml-[18px] pl-3 border-l border-border rounded-[0_var(--radius-sm)_var(--radius-sm)_0]" : ""} ${disabled && !locked ? "opacity-[0.54] hover:bg-transparent" : ""}`}
      title={title}
      aria-disabled={disabled || locked}
      data-testid={`setting-field-${field.key}`}
    >
      <div className="flex flex-1 min-w-0 items-center gap-1.5 text-muted-foreground text-xs font-medium">
        {labelText}
        {field.description && !locked && (
          <span
            className="inline-flex shrink-0 items-center text-muted-foreground"
            aria-label={field.description}
            title={field.description}
          >
            <Icon name="info" size={11} />
          </span>
        )}
        {locked && (
          <span
            className="inline-flex shrink-0 items-center gap-1 px-1.5 py-px border border-border rounded-full bg-muted text-muted-foreground text-2xs font-medium"
            title={LOCKED_TITLE}
          >
            <Icon name="lock" size={10} />
            项目锁定
          </span>
        )}
      </div>
      {control.type === "toggle" && (
        <span className="inline-flex items-center gap-2 shrink-0">
          <Switch checked={Boolean(value)} disabled={disabled || locked} onChange={onCommit} />
          {(control.onText || control.offText) && (
            <span className="text-muted-foreground text-xs whitespace-nowrap">
              {value ? control.onText : control.offText}
            </span>
          )}
        </span>
      )}
      {control.type === "slider" && (
        <span className="inline-flex items-center gap-2 shrink-0">
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
              className="shrink-0 px-2 py-1 appearance-none border border-border rounded-[var(--radius-sm)] bg-card text-muted-foreground text-xs cursor-pointer transition-[border-color,color] duration-150 hover:border-brand hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
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
            const selected = control.options.find((opt) => String(opt.value) === e.target.value);
            if (selected) onCommit(selected.value);
          }}
          className="appearance-none box-border w-full max-w-[130px] px-2 py-1.5 pr-6 border border-border rounded-[var(--radius-sm)] bg-card text-foreground text-xs outline-none cursor-pointer transition-[border-color,box-shadow] duration-150 focus:border-brand focus:shadow-[0_0_0_2px_var(--sc-brand-soft)] disabled:opacity-50 disabled:cursor-not-allowed"
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
      {control.type === "labelContentByType" && (
        <LabelContentByTypeControl
          value={
            value && typeof value === "object" && !Array.isArray(value)
              ? (value as LabelContentByType)
              : { single: [], track: [], ai: [] }
          }
          segments={control.segments}
          disabled={disabled || locked}
          onCommit={onCommit}
        />
      )}
    </Root>
  );
}

/** v0.16.7 · 标签内容按类型分段:顶部段切换(单帧/轨迹/AI),下方该段字段 Switch 列;类别名恒显标必选。 */
function LabelContentByTypeControl({
  value,
  segments,
  disabled,
  onCommit,
}: {
  value: LabelContentByType;
  segments: Array<{
    key: "single" | "track" | "ai";
    label: string;
    options: Array<{ value: string; label: string }>;
  }>;
  disabled: boolean;
  onCommit: (value: LabelContentByType) => void;
}) {
  const [active, setActive] = useState<"single" | "track" | "ai">(segments[0]?.key ?? "single");
  const activeSeg = segments.find((s) => s.key === active) ?? segments[0];
  const selected: string[] = value[active] ?? [];
  const toggle = (optValue: string) => {
    const has = selected.includes(optValue);
    // 按 options 顺序重建当前段,其余段原样保留(提交整个对象)。
    const next = activeSeg.options
      .map((o) => o.value)
      .filter((v) => (v === optValue ? !has : selected.includes(v)));
    onCommit({ ...value, [active]: next } as LabelContentByType);
  };
  return (
    <div className="flex flex-col gap-2">
      <div
        className="inline-flex gap-1 p-0.5 border border-border rounded-[var(--radius-sm)] bg-muted"
        role="tablist"
      >
        {segments.map((s) => (
          <button
            key={s.key}
            type="button"
            role="tab"
            aria-selected={s.key === active}
            className={`flex-1 px-2 py-1 border-0 rounded text-xs cursor-pointer transition-[background,color] duration-150 hover:text-foreground disabled:cursor-not-allowed ${s.key === active ? "bg-card text-brand font-medium" : "bg-transparent text-muted-foreground"}`}
            disabled={disabled}
            onClick={() => setActive(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center justify-between gap-3 min-h-[30px] px-1 py-0.5 text-foreground text-xs cursor-default text-muted-foreground">
          <span>类别名</span>
          <span className="px-1.5 py-px rounded-full bg-muted text-muted-foreground text-2xs">
            必选
          </span>
        </div>
        {activeSeg.options.map((opt) => (
          <label
            key={opt.value}
            className="flex items-center justify-between gap-3 min-h-[30px] px-1 py-0.5 text-foreground text-xs cursor-pointer"
          >
            <span>{opt.label}</span>
            <Switch
              checked={selected.includes(opt.value)}
              disabled={disabled}
              onChange={() => toggle(opt.value)}
            />
          </label>
        ))}
      </div>
    </div>
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
    <span className="inline-flex shrink-0 flex-wrap justify-end gap-1.5 max-w-[200px]" role="group">
      {options.map((opt) => {
        const on = selected.has(opt.value);
        const atFloor = on && value.length <= min;
        return (
          <button
            key={opt.value}
            type="button"
            className={`px-2.5 py-1 appearance-none border rounded-full text-xs cursor-pointer transition-[border-color,background,color] duration-150 hover:border-brand hover:text-foreground disabled:cursor-not-allowed ${on ? "border-brand bg-brand/10 text-brand font-medium disabled:opacity-70" : "border-border bg-card text-muted-foreground"}`}
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
        if (
          e.key === "ArrowLeft" ||
          e.key === "ArrowRight" ||
          e.key === "Home" ||
          e.key === "End"
        ) {
          commit();
        }
      }}
      className="w-[110px] h-1 appearance-none bg-border rounded-sm outline-none cursor-pointer accent-brand disabled:opacity-40 disabled:cursor-not-allowed"
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
      className="appearance-none box-border w-full max-w-[180px] px-2 py-1.5 border border-border rounded-[var(--radius-sm)] bg-card text-foreground text-xs outline-none transition-[border-color,box-shadow] duration-150 focus:border-brand focus:shadow-[0_0_0_2px_var(--sc-brand-soft)] disabled:opacity-50 disabled:cursor-not-allowed"
    />
  );
}
