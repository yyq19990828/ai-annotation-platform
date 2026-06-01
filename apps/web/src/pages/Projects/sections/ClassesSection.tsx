import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { Switch } from "@/components/ui/Switch";
import { useToastStore } from "@/components/ui/Toast";
import { useUpdateProject, useRenameClass } from "@/hooks/useProjects";
import { useUnsavedWarning } from "@/hooks/useUnsavedWarning";
import {
  projectsApi,
  type ProjectResponse,
  type AttributeField,
  type AttributeSchema,
} from "@/api/projects";
import { AttributeSchemaEditor, validateAttributeFields } from "./AttributeSchemaEditor";
import { ClassEditor, type ClassRow } from "./ClassEditor";
import { KeypointSchemaEditor } from "./KeypointSchemaEditor";
import { ToolUnitTabs } from "./ToolUnitTabs";
import type { KeypointSchema } from "@/types";
import {
  unitBindingsToPayload,
  useProjectToolBindings,
} from "./useProjectToolBindings";
import type { ToolUnitId } from "@/constants/toolUnits";
import styles from "./ClassesSection.module.css";

export function ClassesSection({ project }: { project: ProjectResponse }) {
  const pushToast = useToastStore((s) => s.push);
  const update = useUpdateProject(project.id);
  const rename = useRenameClass(project.id);
  const { bindings, setBindings, activeUnit, setActiveUnit, dirty } =
    useProjectToolBindings(project);

  useUnsavedWarning(dirty);

  const handleRename = (oldName: string, newName: string) => {
    // v0.10.17 · 重命名走后端原子 endpoint, 限定 tool_unit_id 仅改本 unit 内的同名类.
    rename.mutate(
      { old_name: oldName, new_name: newName, tool_unit_id: activeUnit },
      {
        onSuccess: () =>
          pushToast({
            msg: `已重命名「${oldName}」→「${newName}」`,
            sub: `已同步迁移 ${activeUnit} 工具单位历史标注`,
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

  const activeBinding = bindings[activeUnit];

  const onChange = (next: ClassRow[]) => {
    setBindings((b) => ({
      ...b,
      [activeUnit]: {
        enabled: b[activeUnit]?.enabled ?? true,
        classRows: next,
        attributeFields: b[activeUnit]?.attributeFields ?? [],
        keypointSchema: b[activeUnit]?.keypointSchema ?? null,
      },
    }));
  };

  const onAttributeChange = (next: AttributeField[]) => {
    setBindings((b) => ({
      ...b,
      [activeUnit]: {
        enabled: b[activeUnit]?.enabled ?? true,
        classRows: b[activeUnit]?.classRows ?? [],
        attributeFields: next,
        keypointSchema: b[activeUnit]?.keypointSchema ?? null,
      },
    }));
  };

  const confirmClassDelete = async (row: ClassRow) => {
    try {
      const usage = await projectsApi.classUsage(project.id);
      const count = usage.classes[row.name] ?? 0;
      const message = count > 0
        ? `类别「${row.name}」已被 ${count} 条标注使用。\n\n删除后这些标注将变为孤儿；暂不影响标注数据，加回同名类别即可恢复。工作台可隐藏孤儿标注，如需彻底清除请运维执行清理。\n\n确认删除？`
        : `类别「${row.name}」暂无标注引用，可放心删除。\n\n确认删除？`;
      return window.confirm(message);
    } catch (err) {
      pushToast({
        msg: "删除前用量统计失败",
        sub: (err as Error).message,
        kind: "error",
      });
      return false;
    }
  };

  const confirmAttributeDelete = async (field: AttributeField) => {
    const key = field.key.trim();
    if (!key) return true;
    try {
      const usage = await projectsApi.classUsage(project.id);
      const count = usage.attributes[key] ?? 0;
      const message = count > 0
        ? `属性「${key}」已被 ${count} 条标注使用。\n\n删除后这些属性值将变为孤儿；暂不影响标注数据，加回同 key 属性即可恢复。工作台可隐藏孤儿标注，如需彻底清除请运维执行清理。\n\n确认删除？`
        : `属性「${key}」暂无标注引用，可放心删除。\n\n确认删除？`;
      return window.confirm(message);
    } catch (err) {
      pushToast({
        msg: "删除前用量统计失败",
        sub: (err as Error).message,
        kind: "error",
      });
      return false;
    }
  };

  const onKeypointSchemaChange = (next: KeypointSchema) => {
    setBindings((b) => ({
      ...b,
      keypoint: {
        enabled: b.keypoint?.enabled ?? true,
        classRows: b.keypoint?.classRows ?? [],
        attributeFields: b.keypoint?.attributeFields ?? [],
        keypointSchema: next,
      },
    }));
  };

  const onToggle = (unit: ToolUnitId, enabled: boolean) => {
    setBindings((b) => ({
      ...b,
      [unit]: {
        enabled,
        classRows: b[unit]?.classRows ?? [],
        attributeFields: b[unit]?.attributeFields ?? [],
        keypointSchema: b[unit]?.keypointSchema ?? null,
      },
    }));
  };

  const onSave = () => {
    for (const k of Object.keys(bindings) as (keyof typeof bindings)[]) {
      const ub = bindings[k];
      if (!ub) continue;
      // 校验所有「会落库」的单位 (启用，或禁用但仍有配置)：禁用单位的属性
      // 现在也会被持久化，半成品空 key 会被后端 (key min_length=1) 拒绝。
      const willPersist =
        ub.enabled ||
        ub.classRows.length > 0 ||
        ub.attributeFields.length > 0 ||
        !!ub.keypointSchema;
      if (!willPersist) continue;
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
          pushToast({ msg: "类别与属性配置已保存", kind: "success" }),
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
        onAttributeChange(parsed.fields);
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
        <h3 className={styles.cardTitle}>类别与属性</h3>
        <div className={styles.headerActions}>
          <Button size="sm" variant="ghost" onClick={onExportJson}>
            <Icon name="download" size={11} />导出属性 JSON
          </Button>
          <label className={styles.importLabel}>
            <input
              type="file"
              accept="application/json"
              onChange={onImportJson}
              className={styles.fileInput}
            />
            <span className={styles.importButton}>
              <Icon name="plus" size={11} />导入属性
            </span>
          </label>
        </div>
      </div>
      <div className={styles.body}>
        <p className={styles.helpText}>
          点击工具单位后，直接维护该工具的类别、颜色、排序和属性 schema；同名类在不同工具单位下相互隔离。
        </p>
        <ToolUnitTabs
          bindings={bindings}
          activeUnit={activeUnit}
          onSelect={setActiveUnit}
        />
        {activeBinding && (
          <>
            <div className={styles.unitEnableRow}>
              <Switch
                checked={activeBinding.enabled}
                onChange={(next) => onToggle(activeUnit, next)}
                label={activeBinding.enabled ? "已启用此工具单位" : "已禁用此工具单位"}
                data-testid="unit-enabled-switch"
              />
              {!activeBinding.enabled && (
                <span className={styles.disabledNote}>
                  禁用后配置仍会保留，但工作台不会使用；需要修改请先启用。
                </span>
              )}
            </div>
            <fieldset
              className={styles.editorFieldset}
              disabled={!activeBinding.enabled}
              aria-disabled={!activeBinding.enabled}
            >
              <div className={styles.editorGrid}>
                <section className={styles.editorPanel}>
                  <h4 className={styles.sectionTitle}>类别</h4>
                  <ClassEditor
                    value={activeBinding.classRows}
                    onChange={onChange}
                    onRename={handleRename}
                    renaming={rename.isPending}
                    onConfirmDelete={confirmClassDelete}
                  />
                </section>
                {activeUnit === "keypoint" && (
                  <section className={styles.editorPanel}>
                    <h4 className={styles.sectionTitle}>关键点骨骼</h4>
                    <KeypointSchemaEditor
                      value={activeBinding.keypointSchema}
                      onChange={onKeypointSchemaChange}
                    />
                  </section>
                )}
                <section className={styles.editorPanel}>
                  <h4 className={styles.sectionTitle}>属性 schema</h4>
                  <AttributeSchemaEditor
                    value={activeBinding.attributeFields}
                    onChange={onAttributeChange}
                    onConfirmDelete={confirmAttributeDelete}
                  />
                </section>
              </div>
            </fieldset>
          </>
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
