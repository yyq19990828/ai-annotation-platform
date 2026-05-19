import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useToastStore } from "@/components/ui/Toast";
import { useUpdateProject, useRenameClass } from "@/hooks/useProjects";
import { useUnsavedWarning } from "@/hooks/useUnsavedWarning";
import type { ProjectResponse } from "@/api/projects";
import { ClassEditor, type ClassRow } from "./ClassEditor";
import { ToolUnitTabs } from "./ToolUnitTabs";
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
      },
    }));
  };

  const onSave = () => {
    const tool_bindings = unitBindingsToPayload(bindings);
    update.mutate(
      { tool_bindings },
      {
        onSuccess: () =>
          pushToast({ msg: "类别配置已保存", kind: "success" }),
        onError: (err) =>
          pushToast({
            msg: "保存失败",
            sub: (err as Error).message,
            kind: "error",
          }),
      },
    );
  };

  return (
    <Card>
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>类别管理（按工具单位 · v0.10.17）</h3>
      </div>
      <div className={styles.body}>
        <p className={styles.helpText}>
          每个工具单位独立维护类别 / 颜色 / 排序; 同名类在不同单位下是独立记录 (强隔离)。
          顺序影响数字键 1-9 / a-z 映射与左侧调色板展示。
        </p>
        <ToolUnitTabs
          bindings={bindings}
          activeUnit={activeUnit}
          onSelect={setActiveUnit}
          allowToggle
          onToggle={onToggle}
        />
        {!activeBinding?.enabled ? (
          <div className={styles.helpText}>
            当前工具单位未启用 — 勾选上方复选框以启用并配置类别。
          </div>
        ) : (
          <ClassEditor
            value={activeBinding.classRows}
            onChange={onChange}
            onRename={handleRename}
            renaming={rename.isPending}
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
