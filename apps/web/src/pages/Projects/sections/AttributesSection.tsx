import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Card } from "@/components/ui/Card";
import { useToastStore } from "@/components/ui/Toast";
import { useUpdateProject } from "@/hooks/useProjects";
import { useUnsavedWarning } from "@/hooks/useUnsavedWarning";
import type { ProjectResponse, AttributeField, AttributeSchema } from "@/api/projects";
import { AttributeSchemaEditor, validateAttributeFields } from "./AttributeSchemaEditor";

export function AttributesSection({ project }: { project: ProjectResponse }) {
  const pushToast = useToastStore((s) => s.push);
  const update = useUpdateProject(project.id);
  const initial = project.attribute_schema?.fields ?? [];
  const [fields, setFields] = useState<AttributeField[]>(initial);

  useEffect(() => {
    setFields(project.attribute_schema?.fields ?? []);
  }, [project.id, project.attribute_schema]);

  const dirty = JSON.stringify(fields) !== JSON.stringify(initial);
  useUnsavedWarning(dirty);

  const onSave = () => {
    const err = validateAttributeFields(fields);
    if (err) {
      pushToast({ msg: err, kind: "error" });
      return;
    }
    const payload: AttributeSchema = { fields };
    update.mutate(
      { attribute_schema: payload },
      {
        onSuccess: () => pushToast({ msg: "属性 schema 已保存", kind: "success" }),
        onError: (err) => pushToast({ msg: "保存失败", sub: (err as Error).message, kind: "error" }),
      },
    );
  };

  const onExportJson = () => {
    const blob = new Blob([JSON.stringify({ fields }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.display_id}-attribute-schema.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result ?? "")) as AttributeSchema;
        if (!Array.isArray(parsed.fields)) throw new Error("缺少 fields 数组");
        setFields(parsed.fields);
        pushToast({ msg: "已导入", kind: "success" });
      } catch (err) {
        pushToast({ msg: "JSON 格式错误", sub: (err as Error).message, kind: "error" });
      }
    };
    reader.readAsText(f);
    e.target.value = "";
  };

  return (
    <Card>
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>标注属性 schema</h3>
        <div style={{ display: "flex", gap: 6 }}>
          <Button size="sm" variant="ghost" onClick={onExportJson}>
            <Icon name="download" size={11} />导出 JSON
          </Button>
          <label style={{ cursor: "pointer" }}>
            <input type="file" accept="application/json" onChange={onImportJson} style={{ display: "none" }} />
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, padding: "3px 8px", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)", color: "var(--color-fg)" }}>
              <Icon name="plus" size={11} />导入
            </span>
          </label>
        </div>
      </div>

      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <p style={{ fontSize: 12, color: "var(--color-fg-muted)", lineHeight: 1.6, margin: 0 }}>
          为本项目配置标注级业务属性（车型 / 朝向 / 是否遮挡等）。标注员选中标注后，右侧栏将根据 schema 渲染表单；改动即时落库。
        </p>

        <AttributeSchemaEditor value={fields} onChange={setFields} />

        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12, paddingTop: 4 }}>
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
