// v0.10.18 · 从 RenderingConfigSection 抽出的受控视图.
//
// 用法:
//   ProjectSettings: <RenderingConfigSection> 持有 useUpdateProject + draft, 包一层
//   TemplateEditModal: 直接渲染 <RenderingConfigEditor value={form.rendering_config} onChange={...} />
//
// 字段集与 User.preferences.workbench 同: smoothImage / cssImageFilter /
// controlPointsSize / snapToGrid. 每行有「覆盖此项」开关 + 控件;
// 开关关闭时显示「跟随用户偏好」, value 中该 key 设为 null 表示不下发.

import { useState } from "react";
import type { ProjectRenderingConfig } from "@/api/projects";
import styles from "./RenderingConfigSection.module.css";

function cn(...xs: Array<string | false | null | undefined>): string {
  return xs.filter(Boolean).join(" ");
}

const DEFAULTS: Required<{
  [K in keyof ProjectRenderingConfig]: NonNullable<ProjectRenderingConfig[K]>;
}> = {
  smoothImage: true,
  cssImageFilter: "",
  controlPointsSize: 6,
  snapToGrid: false,
};

export interface RenderingConfigEditorProps {
  value: ProjectRenderingConfig;
  onChange: (next: ProjectRenderingConfig) => void;
  disabled?: boolean;
}

export function RenderingConfigEditor({
  value,
  onChange,
  disabled,
}: RenderingConfigEditorProps) {
  const [filterInput, setFilterInput] = useState<string>(
    value.cssImageFilter ?? DEFAULTS.cssImageFilter,
  );

  const isOverridden = (key: keyof ProjectRenderingConfig) =>
    value[key] !== null && value[key] !== undefined;

  const commit = (next: ProjectRenderingConfig) => {
    onChange(next);
  };

  const toggleOverride = (key: keyof ProjectRenderingConfig, on: boolean) => {
    if (on) {
      commit({ ...value, [key]: DEFAULTS[key] });
      if (key === "cssImageFilter") setFilterInput(DEFAULTS.cssImageFilter);
    } else {
      const next = { ...value };
      next[key] = null;
      commit(next);
      if (key === "cssImageFilter") setFilterInput(DEFAULTS.cssImageFilter);
    }
  };

  return (
    <fieldset className={styles.body} disabled={disabled}>
      {/* smoothImage */}
      <div className={styles.row}>
        <span className={styles.label}>图像平滑（关闭后像素清晰）</span>
        <label className={styles.overrideToggle}>
          <input
            type="checkbox"
            checked={isOverridden("smoothImage")}
            onChange={(e) => toggleOverride("smoothImage", e.target.checked)}
          />
          <span>覆盖用户偏好</span>
        </label>
        {isOverridden("smoothImage") ? (
          <label className={styles.inlineChoice}>
            <input
              type="checkbox"
              checked={value.smoothImage ?? true}
              onChange={(e) => commit({ ...value, smoothImage: e.target.checked })}
            />
            {value.smoothImage ? "强制开启平滑" : "强制关闭平滑（像素 nearest-neighbor）"}
          </label>
        ) : (
          <span className={styles.followsHint}>跟随用户偏好</span>
        )}
      </div>

      {/* cssImageFilter */}
      <div className={styles.row}>
        <span className={styles.label}>CSS 图像滤镜（例：brightness(1.2) invert(1)）</span>
        <label className={styles.overrideToggle}>
          <input
            type="checkbox"
            checked={isOverridden("cssImageFilter")}
            onChange={(e) => toggleOverride("cssImageFilter", e.target.checked)}
          />
          <span>覆盖用户偏好</span>
        </label>
        {isOverridden("cssImageFilter") ? (
          <input
            value={filterInput}
            onChange={(e) => setFilterInput(e.target.value.slice(0, 255))}
            onBlur={() => {
              if (filterInput !== value.cssImageFilter)
                commit({ ...value, cssImageFilter: filterInput.trim() });
            }}
            placeholder="brightness(1.2) contrast(1.1)"
            className={styles.input}
          />
        ) : (
          <span className={styles.followsHint}>跟随用户偏好</span>
        )}
      </div>

      {/* controlPointsSize */}
      <div className={styles.row}>
        <span className={styles.label}>
          控制点大小（顶点拖拽手柄半径）
          {isOverridden("controlPointsSize") ? `：${value.controlPointsSize}px` : ""}
        </span>
        <label className={styles.overrideToggle}>
          <input
            type="checkbox"
            checked={isOverridden("controlPointsSize")}
            onChange={(e) => toggleOverride("controlPointsSize", e.target.checked)}
          />
          <span>覆盖用户偏好</span>
        </label>
        {isOverridden("controlPointsSize") ? (
          <input
            type="range"
            min={2}
            max={20}
            value={value.controlPointsSize ?? 6}
            onChange={(e) =>
              commit({ ...value, controlPointsSize: Number(e.target.value) })
            }
            className={styles.rangeInput}
          />
        ) : (
          <span className={styles.followsHint}>跟随用户偏好</span>
        )}
      </div>

      {/* snapToGrid */}
      <div className={cn(styles.row, styles.rowLast)}>
        <span className={styles.label}>网格吸附</span>
        <label className={styles.overrideToggle}>
          <input
            type="checkbox"
            checked={isOverridden("snapToGrid")}
            onChange={(e) => toggleOverride("snapToGrid", e.target.checked)}
          />
          <span>覆盖用户偏好</span>
        </label>
        {isOverridden("snapToGrid") ? (
          <label className={styles.inlineChoice}>
            <input
              type="checkbox"
              checked={value.snapToGrid ?? false}
              onChange={(e) => commit({ ...value, snapToGrid: e.target.checked })}
            />
            {value.snapToGrid ? "强制开启吸附" : "强制关闭吸附"}
          </label>
        ) : (
          <span className={styles.followsHint}>跟随用户偏好</span>
        )}
      </div>
    </fieldset>
  );
}
