import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useToastStore } from "@/components/ui/Toast";
import { useUpdateProject, useRenameClass } from "@/hooks/useProjects";
import { useUnsavedWarning } from "@/hooks/useUnsavedWarning";
import type { ProjectResponse, ClassesConfig } from "@/api/projects";
import { ClassEditor, defaultColorFor, type ClassRow } from "./ClassEditor";
import styles from "./ClassesSection.module.css";

function buildRows(project: ProjectResponse): ClassRow[] {
  const cfg = project.classes_config ?? {};
  const ordered = (project.classes ?? []).slice().sort((a, b) => {
    const oa = cfg[a]?.order ?? Number.POSITIVE_INFINITY;
    const ob = cfg[b]?.order ?? Number.POSITIVE_INFINITY;
    return oa - ob;
  });
  return ordered.map((name) => ({
    name,
    color: cfg[name]?.color ?? defaultColorFor(name),
    alias: cfg[name]?.alias ?? undefined,
  }));
}

export function ClassesSection({ project }: { project: ProjectResponse }) {
  const pushToast = useToastStore((s) => s.push);
  const update = useUpdateProject(project.id);
  const rename = useRenameClass(project.id);
  const [rows, setRows] = useState<ClassRow[]>(() => buildRows(project));

  const handleRename = (oldName: string, newName: string) => {
    rename.mutate(
      { old_name: oldName, new_name: newName },
      {
        onSuccess: () =>
          pushToast({
            msg: `已重命名「${oldName}」→「${newName}」`,
            sub: "已同步迁移历史标注",
            kind: "success",
          }),
        onError: (err) =>
          pushToast({
            msg: "重命名失败",
            sub: (err as Error).message,
            kind: "error",
          }),
      },
    );
  };

  useEffect(() => { setRows(buildRows(project)); }, [project]);

  const initial = useMemo(() => buildRows(project), [project]);
  const dirty = JSON.stringify(rows) !== JSON.stringify(initial);
  useUnsavedWarning(dirty);

  const onSave = () => {
    const classes = rows.map((r) => r.name);
    const classes_config: ClassesConfig = {};
    rows.forEach((r, i) => {
      classes_config[r.name] = {
        color: r.color,
        order: i,
        ...(r.alias ? { alias: r.alias } : {}),
      };
    });
    update.mutate(
      { classes, classes_config },
      {
        onSuccess: () => pushToast({ msg: "类别配置已保存", kind: "success" }),
        onError: (err) => pushToast({ msg: "保存失败", sub: (err as Error).message, kind: "error" }),
      },
    );
  };

  return (
    <Card>
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>类别管理（颜色 + 排序）</h3>
      </div>
      <div className={styles.body}>
        <p className={styles.helpText}>
          每个类别可独立配置颜色（标注框 stroke / 标签底色）。顺序影响数字键 1-9 / a-z 映射与左侧类别面板展示。
        </p>
        <ClassEditor
          value={rows}
          onChange={setRows}
          onRename={handleRename}
          renaming={rename.isPending}
        />
        <div className={styles.footer}>
          {dirty && (
            <span
              className={styles.unsavedIndicator}
              data-testid="unsaved-indicator"
            >
              <span className={styles.unsavedDot} />
              有未保存的修改
            </span>
          )}
          <Button variant="primary" disabled={!dirty || update.isPending} onClick={onSave}>
            {update.isPending ? "保存中..." : "保存"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
