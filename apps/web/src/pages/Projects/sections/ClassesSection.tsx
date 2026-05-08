import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useToastStore } from "@/components/ui/Toast";
import { useUpdateProject } from "@/hooks/useProjects";
import { useUnsavedWarning } from "@/hooks/useUnsavedWarning";
import type { ProjectResponse, ClassesConfig } from "@/api/projects";
import { ClassEditor, defaultColorFor, type ClassRow } from "./ClassEditor";

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
  const [rows, setRows] = useState<ClassRow[]>(() => buildRows(project));

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
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)" }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>类别管理（颜色 + 排序）</h3>
      </div>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <p style={{ fontSize: 12, color: "var(--color-fg-muted)", margin: 0, lineHeight: 1.5 }}>
          每个类别可独立配置颜色（标注框 stroke / 标签底色）。顺序影响数字键 1-9 / a-z 映射与左侧类别面板展示。
        </p>
        <ClassEditor value={rows} onChange={setRows} />
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12 }}>
          {dirty && (
            <span
              style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--color-warning)", fontWeight: 500 }}
              data-testid="unsaved-indicator"
            >
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--color-warning)" }} />
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
