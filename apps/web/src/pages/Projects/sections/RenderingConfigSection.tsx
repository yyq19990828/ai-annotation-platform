// v0.10.10 · I17.3 · 项目级渲染配置覆盖（ProjectSettings 子页）。
//
// 字段集与 User.preferences.workbench 同：smoothImage / cssImageFilter /
// controlPointsSize / snapToGrid（不含 longTaskSampleRate）。
// 每行有「覆盖此项」开关 + 控件；开关关闭时显示「跟随用户偏好」并不发送该字段。
// PATCH 整个 rendering_config 对象；后端 Pydantic ProjectRenderingConfig
// (extra=forbid, 字段范围校验) 兜底。

import { useState, type CSSProperties } from "react";
import { Card } from "@/components/ui/Card";
import { useToastStore } from "@/components/ui/Toast";
import { useUpdateProject } from "@/hooks/useProjects";
import type { ProjectResponse, ProjectRenderingConfig } from "@/api/projects";

const labelStyle: CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 500,
  color: "var(--color-fg-muted)",
  marginBottom: 6,
};

const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 11px",
  fontSize: 13.5,
  background: "var(--color-bg-sunken)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-md)",
  color: "var(--color-fg)",
  outline: "none",
  fontFamily: "inherit",
};

const rowStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  padding: "10px 0",
  borderBottom: "1px solid var(--color-border)",
};

const overrideToggleStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontSize: 12,
  color: "var(--color-fg-muted)",
  cursor: "pointer",
};

const followsHintStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--color-fg-muted)",
  fontStyle: "italic",
};

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
      <div style={{ padding: 16 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>渲染配置（项目级覆盖）</h3>
        <p style={{ fontSize: 12.5, color: "var(--color-fg-muted)", marginTop: 6 }}>
          项目级覆盖优先于成员的个人「标注偏好」。常用于医学影像等强制「无插值 / 灰度反色」的场景。
        </p>

        {/* smoothImage */}
        <div style={rowStyle}>
          <span style={labelStyle}>图像平滑（关闭后像素清晰）</span>
          <label style={overrideToggleStyle}>
            <input
              type="checkbox"
              checked={isOverridden("smoothImage")}
              onChange={(e) => toggleOverride("smoothImage", e.target.checked)}
            />
            <span>覆盖用户偏好</span>
          </label>
          {isOverridden("smoothImage") ? (
            <label style={{ fontSize: 13, display: "inline-flex", gap: 8 }}>
              <input
                type="checkbox"
                checked={draft.smoothImage ?? true}
                onChange={(e) => commit({ ...draft, smoothImage: e.target.checked })}
              />
              {draft.smoothImage ? "强制开启平滑" : "强制关闭平滑（像素 nearest-neighbor）"}
            </label>
          ) : (
            <span style={followsHintStyle}>跟随用户偏好</span>
          )}
        </div>

        {/* cssImageFilter */}
        <div style={rowStyle}>
          <span style={labelStyle}>CSS 图像滤镜（例：brightness(1.2) invert(1)）</span>
          <label style={overrideToggleStyle}>
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
              style={inputStyle}
            />
          ) : (
            <span style={followsHintStyle}>跟随用户偏好</span>
          )}
        </div>

        {/* controlPointsSize */}
        <div style={rowStyle}>
          <span style={labelStyle}>
            控制点大小（顶点拖拽手柄半径）
            {isOverridden("controlPointsSize") ? `：${draft.controlPointsSize}px` : ""}
          </span>
          <label style={overrideToggleStyle}>
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
              style={{ width: "100%" }}
            />
          ) : (
            <span style={followsHintStyle}>跟随用户偏好</span>
          )}
        </div>

        {/* snapToGrid */}
        <div style={{ ...rowStyle, borderBottom: "none" }}>
          <span style={labelStyle}>网格吸附</span>
          <label style={overrideToggleStyle}>
            <input
              type="checkbox"
              checked={isOverridden("snapToGrid")}
              onChange={(e) => toggleOverride("snapToGrid", e.target.checked)}
            />
            <span>覆盖用户偏好</span>
          </label>
          {isOverridden("snapToGrid") ? (
            <label style={{ fontSize: 13, display: "inline-flex", gap: 8 }}>
              <input
                type="checkbox"
                checked={draft.snapToGrid ?? false}
                onChange={(e) => commit({ ...draft, snapToGrid: e.target.checked })}
              />
              {draft.snapToGrid ? "强制开启吸附" : "强制关闭吸附"}
            </label>
          ) : (
            <span style={followsHintStyle}>跟随用户偏好</span>
          )}
        </div>

        {update.isPending && (
          <div style={{ marginTop: 12, fontSize: 12, color: "var(--color-fg-muted)" }}>
            保存中…
          </div>
        )}
      </div>
    </Card>
  );
}
