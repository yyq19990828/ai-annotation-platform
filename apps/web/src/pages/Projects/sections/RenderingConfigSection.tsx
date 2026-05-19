// v0.10.10 · I17.3 · 项目级渲染配置覆盖（ProjectSettings 子页）。
// v0.10.18 · 视图层抽出为 RenderingConfigEditor, Section 仅作保存外壳.
//
// 字段集与 User.preferences.workbench 同：smoothImage / cssImageFilter /
// controlPointsSize / snapToGrid（不含 longTaskSampleRate）。
// PATCH 整个 rendering_config 对象；后端 Pydantic ProjectRenderingConfig
// (extra=forbid, 字段范围校验) 兜底。

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { useToastStore } from "@/components/ui/Toast";
import { useUpdateProject } from "@/hooks/useProjects";
import type { ProjectResponse, ProjectRenderingConfig } from "@/api/projects";
import { RenderingConfigEditor } from "./RenderingConfigEditor";
import styles from "./RenderingConfigSection.module.css";

export function RenderingConfigSection({ project }: { project: ProjectResponse }) {
  const pushToast = useToastStore((s) => s.push);
  const update = useUpdateProject(project.id);
  const [draft, setDraft] = useState<ProjectRenderingConfig>(
    project.rendering_config ?? {},
  );

  const onChange = (next: ProjectRenderingConfig) => {
    setDraft(next);
    update.mutate(
      { rendering_config: next },
      {
        onError: () => pushToast({ msg: "保存失败", kind: "warning" }),
      },
    );
  };

  return (
    <Card>
      <div className={styles.body}>
        <h3 className={styles.title}>渲染配置（项目级覆盖）</h3>
        <p className={styles.description}>
          项目级覆盖优先于成员的个人「标注偏好」。常用于医学影像等强制「无插值 / 灰度反色」的场景。
        </p>
        <RenderingConfigEditor
          value={draft}
          onChange={onChange}
          disabled={update.isPending}
        />
        {update.isPending && <div className={styles.savingHint}>保存中…</div>}
      </div>
    </Card>
  );
}
