import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Card } from "@/components/ui/Card";
import { useToastStore } from "@/components/ui/Toast";
import { useUpdateProject } from "@/hooks/useProjects";
import { useUnsavedWarning } from "@/hooks/useUnsavedWarning";
import type {
  ProjectResponse,
  AttributeField,
  AttributeSchema,
} from "@/api/projects";
import { AttributeSchemaEditor, validateAttributeFields } from "./AttributeSchemaEditor";
import { ToolUnitTabs } from "./ToolUnitTabs";
import {
  unitBindingsToPayload,
  useProjectToolBindings,
} from "./useProjectToolBindings";
import styles from "./AttributesSection.module.css";

export function AttributesSection({ project }: { project: ProjectResponse }) {
  const pushToast = useToastStore((s) => s.push);
  const update = useUpdateProject(project.id);
  const { bindings, setBindings, activeUnit, setActiveUnit, dirty } =
    useProjectToolBindings(project);

  useUnsavedWarning(dirty);

  const activeBinding = bindings[activeUnit];

  const onChange = (next: AttributeField[]) => {
    setBindings((b) => ({
      ...b,
      [activeUnit]: {
        enabled: b[activeUnit]?.enabled ?? true,
        classRows: b[activeUnit]?.classRows ?? [],
        attributeFields: next,
      },
    }));
  };

  const onSave = () => {
    // 校验所有 enabled unit
    for (const k of Object.keys(bindings) as (keyof typeof bindings)[]) {
      const ub = bindings[k];
      if (!ub?.enabled) continue;
      const err = validateAttributeFields(ub.attributeFields);
      if (err) {
        pushToast({ msg: `[${k}] ${err}`, kind: "error" });
        return;
      }
    }
    const tool_bindings = unitBindingsToPayload(bindings);
    update.mutate(
      { tool_bindings },
      {
        onSuccess: () =>
          pushToast({ msg: "属性 schema 已保存", kind: "success" }),
        onError: (err) =>
          pushToast({
            msg: "保存失败",
            sub: (err as Error).message,
            kind: "error",
          }),
      },
    );
  };

  const onExportJson = () => {
    const fields = activeBinding?.attributeFields ?? [];
    const blob = new Blob([JSON.stringify({ fields }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.display_id}-${activeUnit}-attribute-schema.json`;
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
        onChange(parsed.fields);
        pushToast({ msg: `已导入到 ${activeUnit} 工具单位`, kind: "success" });
      } catch (err) {
        pushToast({
          msg: "JSON 格式错误",
          sub: (err as Error).message,
          kind: "error",
        });
      }
    };
    reader.readAsText(f);
    e.target.value = "";
  };

  return (
    <Card>
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>标注属性 schema（按工具单位 · v0.10.17）</h3>
        <div className={styles.headerActions}>
          <Button size="sm" variant="ghost" onClick={onExportJson}>
            <Icon name="download" size={11} />导出 JSON
          </Button>
          <label className={styles.importLabel}>
            <input
              type="file"
              accept="application/json"
              onChange={onImportJson}
              className={styles.fileInput}
            />
            <span className={styles.importButton}>
              <Icon name="plus" size={11} />导入
            </span>
          </label>
        </div>
      </div>

      <div className={styles.body}>
        <p className={styles.helpText}>
          属性 schema 按工具单位独立维护; 同一项目可让 bbox 工具有「朝向 / 遮挡」, region 工具有「面积估值」, 互不影响。
        </p>

        <ToolUnitTabs
          bindings={bindings}
          activeUnit={activeUnit}
          onSelect={setActiveUnit}
        />

        {!activeBinding?.enabled ? (
          <p className={styles.helpText}>
            当前工具单位未启用 — 到「类别」页勾选启用后才能配置属性。
          </p>
        ) : (
          <AttributeSchemaEditor
            value={activeBinding.attributeFields}
            onChange={onChange}
          />
        )}

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
