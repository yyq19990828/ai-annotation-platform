// v0.10.29 · 项目级视频帧采样配置（逻辑采样，见
// docs/plans/2026-05-21-v0.10.29-video-frame-sampling.md §2/§4 Wave2-D）。
//
// 仅在 data_type === "video" 的项目设置页渲染。
// mode=none 不采样；mode=fps 按目标 fps；mode=step 按帧间隔。
// 保存走 useUpdateProject (PATCH)，payload { video_sampling: {...} }。
//
// 结构/样式/保存交互仿 RenderingConfigSection.tsx。

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useToastStore } from "@/components/ui/Toast";
import { useUpdateProject } from "@/hooks/useProjects";
import type { ProjectResponse, VideoSamplingConfig } from "@/api/projects";
import styles from "./VideoSamplingSection.module.css";

type SamplingMode = "none" | "fps" | "step";

interface DraftState {
  mode: SamplingMode;
  /** fps 模式的目标帧率原始输入（保留字符串以便编辑） */
  targetFps: string;
  /** step 模式的帧间隔原始输入 */
  frameStep: string;
}

function initDraft(cfg: VideoSamplingConfig | null | undefined): DraftState {
  const mode = (cfg?.mode ?? "none") as SamplingMode;
  return {
    mode,
    targetFps: cfg?.target_fps != null ? String(cfg.target_fps) : "",
    frameStep: cfg?.frame_step != null ? String(cfg.frame_step) : "",
  };
}

/** 把草稿状态转成后端 payload；非法时返回 null。 */
function buildConfig(draft: DraftState): VideoSamplingConfig | null {
  if (draft.mode === "none") return { mode: "none" };
  if (draft.mode === "fps") {
    const fps = Number(draft.targetFps);
    if (!Number.isFinite(fps) || fps <= 0) return null;
    return { mode: "fps", target_fps: fps };
  }
  // step
  const step = Number(draft.frameStep);
  if (!Number.isInteger(step) || step < 1) return null;
  return { mode: "step", frame_step: step };
}

/** 预览文案：源 fps 在设置页拿不到，故只回显逻辑关系。 */
function previewText(draft: DraftState): string {
  if (draft.mode === "none") {
    return "不采样：所有源帧都是导航网格点（每 1 帧打点）。";
  }
  if (draft.mode === "fps") {
    const fps = Number(draft.targetFps);
    if (!Number.isFinite(fps) || fps <= 0) return "请填写大于 0 的目标 fps。";
    return `源视频 按视频实际帧率 → 标注 ${fps} fps（每隔约 round(源fps / ${fps}) 帧打点）。`;
  }
  const step = Number(draft.frameStep);
  if (!Number.isInteger(step) || step < 1) return "请填写 ≥1 的整数帧间隔。";
  return `源视频 按视频实际帧率 → 每 ${step} 帧打点（step=${step}）。`;
}

export function VideoSamplingSection({ project }: { project: ProjectResponse }) {
  const pushToast = useToastStore((s) => s.push);
  const update = useUpdateProject(project.id);
  const [draft, setDraft] = useState<DraftState>(() =>
    initDraft(project.video_sampling),
  );

  const config = buildConfig(draft);
  const valid = config !== null;

  const onSave = () => {
    if (!config) {
      pushToast({ msg: "采样配置不合法，请检查输入", kind: "warning" });
      return;
    }
    update.mutate(
      { video_sampling: config },
      {
        onError: () => pushToast({ msg: "保存失败", kind: "warning" }),
        onSuccess: () => pushToast({ msg: "已保存采样配置", kind: "success" }),
      },
    );
  };

  return (
    <Card>
      <div className={styles.body}>
        <h3 className={styles.title}>视频帧采样（逻辑采样）</h3>
        <p className={styles.description}>
          采样只约束「逐帧导航 + 打点」的网格，不会物理重采样或取代原视频；连续播放仍走原始帧率与所有帧。
        </p>

        <div className={styles.row}>
          <span className={styles.label}>采样方式</span>
          <div className={styles.modeChoices}>
            <label className={styles.modeChoice}>
              <input
                type="radio"
                name="video-sampling-mode"
                checked={draft.mode === "none"}
                onChange={() => setDraft((d) => ({ ...d, mode: "none" }))}
              />
              <span>不采样（所有帧）</span>
            </label>
            <label className={styles.modeChoice}>
              <input
                type="radio"
                name="video-sampling-mode"
                checked={draft.mode === "fps"}
                onChange={() => setDraft((d) => ({ ...d, mode: "fps" }))}
              />
              <span>按目标 fps</span>
            </label>
            <label className={styles.modeChoice}>
              <input
                type="radio"
                name="video-sampling-mode"
                checked={draft.mode === "step"}
                onChange={() => setDraft((d) => ({ ...d, mode: "step" }))}
              />
              <span>按帧间隔</span>
            </label>
          </div>
        </div>

        {draft.mode === "fps" && (
          <div className={styles.row}>
            <label className={styles.label} htmlFor="video-target-fps">
              目标 fps（&gt; 0）
            </label>
            <input
              id="video-target-fps"
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              value={draft.targetFps}
              onChange={(e) =>
                setDraft((d) => ({ ...d, targetFps: e.target.value }))
              }
              placeholder="例：10"
              className={styles.input}
            />
          </div>
        )}

        {draft.mode === "step" && (
          <div className={styles.row}>
            <label className={styles.label} htmlFor="video-frame-step">
              帧间隔（整数，&ge; 1）
            </label>
            <input
              id="video-frame-step"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={draft.frameStep}
              onChange={(e) =>
                setDraft((d) => ({ ...d, frameStep: e.target.value }))
              }
              placeholder="例：5"
              className={styles.input}
            />
          </div>
        )}

        <div className={styles.preview} data-testid="video-sampling-preview">
          {previewText(draft)}
        </div>

        {!valid && (
          <p className={styles.error}>请填写合法的采样参数后再保存。</p>
        )}

        <div className={styles.actions}>
          <Button onClick={onSave} disabled={!valid || update.isPending}>
            保存
          </Button>
          {update.isPending && (
            <span className={styles.savingHint}>保存中…</span>
          )}
        </div>
      </div>
    </Card>
  );
}
