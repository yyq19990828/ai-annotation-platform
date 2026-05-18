// v0.10.10 · I17.3 · 项目级渲染配置覆盖（ProjectSettings 子页）。
//
// 字段集与 User.preferences.workbench 同：smoothImage / cssImageFilter /
// controlPointsSize / snapToGrid（不含 longTaskSampleRate）。
// 每行有「覆盖此项」开关 + 控件；开关关闭时显示「跟随用户偏好」并不发送该字段。
// PATCH 整个 rendering_config 对象；后端 Pydantic ProjectRenderingConfig
// (extra=forbid, 字段范围校验) 兜底。

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { useToastStore } from "@/components/ui/Toast";
import { useUpdateProject } from "@/hooks/useProjects";
import type { ProjectResponse, ProjectRenderingConfig } from "@/api/projects";
import styles from "./RenderingConfigSection.module.css";

function cn(...xs: Array<string | false | null | undefined>): string {
  return xs.filter(Boolean).join(" ");
}

const DEFAULTS: Required<{ [K in keyof ProjectRenderingConfig]: NonNullable<ProjectRenderingConfig[K]> }> = {
  smoothImage: true,
  cssImageFilter: "",
  controlPointsSize: 6,
  snapToGrid: false,
};

export function RenderingConfigSection({ project }: { project: ProjectResponse }) {
  const pushToast = useToastStore((s) => s.push);
  const update = useUpdateProject(project.id);
  const initial: ProjectRenderingConfig = project.rendering_config ?? {};
  const [draft, setDraft] = useState<ProjectRenderingConfig>(initial);
  const [filterInput, setFilterInput] = useState<string>(
    initial.cssImageFilter ?? DEFAULTS.cssImageFilter,
  );

  const isOverridden = (key: keyof ProjectRenderingConfig) =>
    draft[key] !== null && draft[key] !== undefined;

  const commit = (next: ProjectRenderingConfig) => {
    setDraft(next);
    update.mutate(
      { rendering_config: next },
      {
        onError: () => pushToast({ msg: "保存失败", kind: "warning" }),
      },
    );
  };

  const toggleOverride = (key: keyof ProjectRenderingConfig, on: boolean) => {
    if (on) {
      commit({ ...draft, [key]: DEFAULTS[key] });
      if (key === "cssImageFilter") setFilterInput(DEFAULTS.cssImageFilter);
    } else {
      const next = { ...draft };
      next[key] = null;
      commit(next);
      if (key === "cssImageFilter") setFilterInput(DEFAULTS.cssImageFilter);
    }
  };

  return (
    <Card>
      <div className={styles.body}>
        <h3 className={styles.title}>渲染配置（项目级覆盖）</h3>
        <p className={styles.description}>
          项目级覆盖优先于成员的个人「标注偏好」。常用于医学影像等强制「无插值 / 灰度反色」的场景。
        </p>

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
                checked={draft.smoothImage ?? true}
                onChange={(e) => commit({ ...draft, smoothImage: e.target.checked })}
              />
              {draft.smoothImage ? "强制开启平滑" : "强制关闭平滑（像素 nearest-neighbor）"}
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
                if (filterInput !== draft.cssImageFilter)
                  commit({ ...draft, cssImageFilter: filterInput.trim() });
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
            {isOverridden("controlPointsSize") ? `：${draft.controlPointsSize}px` : ""}
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
              value={draft.controlPointsSize ?? 6}
              onChange={(e) =>
                commit({ ...draft, controlPointsSize: Number(e.target.value) })
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
                checked={draft.snapToGrid ?? false}
                onChange={(e) => commit({ ...draft, snapToGrid: e.target.checked })}
              />
              {draft.snapToGrid ? "强制开启吸附" : "强制关闭吸附"}
            </label>
          ) : (
            <span className={styles.followsHint}>跟随用户偏好</span>
          )}
        </div>

        {update.isPending && (
          <div className={styles.savingHint}>
            保存中…
          </div>
        )}
      </div>
    </Card>
  );
}
