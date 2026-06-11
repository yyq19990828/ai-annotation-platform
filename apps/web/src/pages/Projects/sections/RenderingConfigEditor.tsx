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
  box3dDefaultSize: [4.0, 1.8, 1.6],
  propagateOverwrite: false,
  trackerDefaultModel: "sam2_video",
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
  const [trackerInput, setTrackerInput] = useState<string>(
    value.trackerDefaultModel ?? DEFAULTS.trackerDefaultModel,
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
      if (key === "trackerDefaultModel") setTrackerInput(DEFAULTS.trackerDefaultModel);
    } else {
      const next = { ...value };
      next[key] = null;
      commit(next);
      if (key === "cssImageFilter") setFilterInput(DEFAULTS.cssImageFilter);
      if (key === "trackerDefaultModel") setTrackerInput(DEFAULTS.trackerDefaultModel);
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
      <div className={styles.row}>
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

      {/* box3dDefaultSize */}
      <div className={styles.row}>
        <span className={styles.label}>3D 新框默认尺寸（长 / 宽 / 高，米）</span>
        <label className={styles.overrideToggle}>
          <input
            type="checkbox"
            checked={isOverridden("box3dDefaultSize")}
            onChange={(e) => toggleOverride("box3dDefaultSize", e.target.checked)}
          />
          <span>覆盖默认值</span>
        </label>
        {isOverridden("box3dDefaultSize") ? (
          <div className={styles.inlineInputs}>
            {(["长", "宽", "高"] as const).map((label, idx) => (
              <label key={label} className={styles.compactNumber}>
                <span>{label}</span>
                <input
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={(value.box3dDefaultSize ?? DEFAULTS.box3dDefaultSize)[idx]}
                  onChange={(e) => {
                    const next = [...(value.box3dDefaultSize ?? DEFAULTS.box3dDefaultSize)] as [number, number, number];
                    next[idx] = Math.max(0.1, Number(e.target.value) || DEFAULTS.box3dDefaultSize[idx]);
                    commit({ ...value, box3dDefaultSize: next });
                  }}
                  className={styles.numberInput}
                />
              </label>
            ))}
          </div>
        ) : (
          <span className={styles.followsHint}>使用平台默认 4.0 / 1.8 / 1.6</span>
        )}
      </div>

      {/* propagateOverwrite */}
      <div className={styles.row}>
        <span className={styles.label}>关键帧复制覆盖策略</span>
        <label className={styles.overrideToggle}>
          <input
            type="checkbox"
            checked={isOverridden("propagateOverwrite")}
            onChange={(e) => toggleOverride("propagateOverwrite", e.target.checked)}
          />
          <span>项目锁定</span>
        </label>
        {isOverridden("propagateOverwrite") ? (
          <label className={styles.inlineChoice}>
            <input
              type="checkbox"
              checked={value.propagateOverwrite ?? false}
              onChange={(e) => commit({ ...value, propagateOverwrite: e.target.checked })}
            />
            {value.propagateOverwrite ? "强制覆盖目标关键帧" : "强制保留目标关键帧"}
          </label>
        ) : (
          <span className={styles.followsHint}>由用户在复制对话框中决定</span>
        )}
      </div>

      {/* trackerDefaultModel */}
      <div className={cn(styles.row, styles.rowLast)}>
        <span className={styles.label}>AI 传播默认模型</span>
        <label className={styles.overrideToggle}>
          <input
            type="checkbox"
            checked={isOverridden("trackerDefaultModel")}
            onChange={(e) => toggleOverride("trackerDefaultModel", e.target.checked)}
          />
          <span>覆盖默认值</span>
        </label>
        {isOverridden("trackerDefaultModel") ? (
          <input
            value={trackerInput}
            onChange={(e) => setTrackerInput(e.target.value.slice(0, 128))}
            onBlur={() => {
              const next = trackerInput.trim();
              if (next !== value.trackerDefaultModel) {
                commit({ ...value, trackerDefaultModel: next || DEFAULTS.trackerDefaultModel });
              }
            }}
            placeholder="sam2_video"
            className={styles.input}
          />
        ) : (
          <span className={styles.followsHint}>跟随项目后端与用户记忆</span>
        )}
      </div>
    </fieldset>
  );
}
