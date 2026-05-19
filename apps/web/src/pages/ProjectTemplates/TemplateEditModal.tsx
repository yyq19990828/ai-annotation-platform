// v0.10.14 · E2 · 模板新建 / 编辑表单 (Modal).
// v0.10.17 · 加 tool_bindings 编辑能力 (基础 / 工具与类别 / 渲染配置 三 tab),
// 复用 ProjectSettings 的 ClassEditor / AttributeSchemaEditor / ToolUnitTabs.

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToastStore } from "@/components/ui/Toast";
import { PROJECT_TYPES } from "@/constants/projectTypes";
import { usePermissions } from "@/hooks/usePermissions";
import {
  useCreateProjectTemplate,
  useUpdateProjectTemplate,
} from "@/hooks/useProjectTemplates";
import type {
  ProjectTemplateOut,
  TemplateScope,
} from "@/api/projectTemplates";
import type { AttributeField } from "@/api/projects";
import {
  ClassEditor,
  type ClassRow,
} from "@/pages/Projects/sections/ClassEditor";
import { AttributeSchemaEditor } from "@/pages/Projects/sections/AttributeSchemaEditor";
import { ToolUnitTabs } from "@/pages/Projects/sections/ToolUnitTabs";
import {
  buildUnitBindings,
  unitBindingsToPayload,
  type UnitBindingMap,
} from "@/pages/Projects/sections/useProjectToolBindings";
import { type ToolUnitId } from "@/constants/toolUnits";

import styles from "./ProjectTemplatesPage.module.css";

interface Props {
  open: boolean;
  onClose: () => void;
  /** undefined = 新建; 给值 = 编辑. */
  initial?: ProjectTemplateOut;
}

type Tab = "basic" | "tools" | "rendering";

export function TemplateEditModal({ open, onClose, initial }: Props) {
  const pushToast = useToastStore((s) => s.push);
  const { role } = usePermissions();
  const isEdit = !!initial;
  const create = useCreateProjectTemplate();
  const update = useUpdateProjectTemplate(initial?.id ?? "");

  const [tab, setTab] = useState<Tab>("basic");
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [scope, setScope] = useState<TemplateScope>(initial?.scope ?? "private");
  const [typeKey, setTypeKey] = useState(initial?.type_key ?? PROJECT_TYPES[0].key);
  const [annotationGuide, setAnnotationGuide] = useState(
    initial?.annotation_guide ?? "",
  );
  const [bindings, setBindings] = useState<UnitBindingMap>(() =>
    buildUnitBindings({
      type_key: initial?.type_key,
      classes: initial?.classes,
      classes_config: initial?.classes_config,
      attribute_schema: initial?.attribute_schema,
      tool_bindings: initial?.tool_bindings,
    }),
  );
  const [activeUnit, setActiveUnit] = useState<ToolUnitId>("bbox");

  useEffect(() => {
    setName(initial?.name ?? "");
    setDescription(initial?.description ?? "");
    setScope(initial?.scope ?? "private");
    setTypeKey(initial?.type_key ?? PROJECT_TYPES[0].key);
    setAnnotationGuide(initial?.annotation_guide ?? "");
    setBindings(
      buildUnitBindings({
        type_key: initial?.type_key,
        classes: initial?.classes,
        classes_config: initial?.classes_config,
        attribute_schema: initial?.attribute_schema,
        tool_bindings: initial?.tool_bindings,
      }),
    );
    setTab("basic");
  }, [initial, open]);

  const typeLabel = useMemo(
    () =>
      PROJECT_TYPES.find((t) => t.key === typeKey)?.label ?? typeKey,
    [typeKey],
  );

  const activeBinding = bindings[activeUnit];

  const onChangeClasses = (next: ClassRow[]) => {
    setBindings((b) => ({
      ...b,
      [activeUnit]: {
        enabled: b[activeUnit]?.enabled ?? true,
        classRows: next,
        attributeFields: b[activeUnit]?.attributeFields ?? [],
      },
    }));
  };

  const onChangeAttributes = (next: AttributeField[]) => {
    setBindings((b) => ({
      ...b,
      [activeUnit]: {
        enabled: b[activeUnit]?.enabled ?? true,
        classRows: b[activeUnit]?.classRows ?? [],
        attributeFields: next,
      },
    }));
  };

  const onToggleUnit = (unit: ToolUnitId, enabled: boolean) => {
    setBindings((b) => ({
      ...b,
      [unit]: {
        enabled,
        classRows: b[unit]?.classRows ?? [],
        attributeFields: b[unit]?.attributeFields ?? [],
      },
    }));
  };

  const canPickPublic = role === "super_admin";
  const submitting = create.isPending || update.isPending;

  const handleSubmit = () => {
    if (!name.trim()) {
      pushToast({ msg: "请填写模板名称", kind: "warning" });
      return;
    }
    const tool_bindings = unitBindingsToPayload(bindings);
    // v0.10.17 · 旧扁平 classes 派生自首个 enabled unit, 兼容旧 reader.
    const firstUnitClasses =
      (Object.keys(tool_bindings) as ToolUnitId[])
        .map((k) => tool_bindings[k]?.classes ?? [])
        .find((cs) => cs.length > 0) ?? [];
    const classes = firstUnitClasses.map((c) => c.name);

    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      type_label: typeLabel,
      type_key: typeKey,
      classes,
      tool_bindings,
      annotation_guide: annotationGuide.trim() || null,
      scope,
    };

    if (isEdit) {
      update.mutate(payload, {
        onSuccess: () => {
          pushToast({ msg: "已保存模板", kind: "success" });
          onClose();
        },
        onError: (err) =>
          pushToast({
            msg: err instanceof Error ? err.message : "保存失败",
            kind: "warning",
          }),
      });
    } else {
      create.mutate(payload, {
        onSuccess: () => {
          pushToast({ msg: "模板已创建", kind: "success" });
          onClose();
        },
        onError: (err) =>
          pushToast({
            msg: err instanceof Error ? err.message : "创建失败",
            kind: "warning",
          }),
      });
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? "编辑模板" : "新建模板"} width={680}>
      <div className={styles.modalBody}>
        <div className={styles.tabs}>
          {(["basic", "tools", "rendering"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              className={t === tab ? styles.tabActive : styles.tab}
              onClick={() => setTab(t)}
            >
              {t === "basic" ? "基础信息" : t === "tools" ? "工具与类别" : "渲染配置"}
            </button>
          ))}
        </div>

        {tab === "basic" && (
          <>
            <label className={styles.label}>
              名称
              <input
                className={styles.input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="如：道路场景标准模板"
              />
            </label>

            <label className={styles.label}>
              描述（可选）
              <textarea
                className={styles.textarea}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="模板用途、适用场景"
              />
            </label>

            <label className={styles.label}>
              项目类型
              <select
                className={styles.select}
                value={typeKey}
                onChange={(e) => setTypeKey(e.target.value)}
              >
                {PROJECT_TYPES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.label}>
              标注指引（Markdown，可选）
              <textarea
                className={styles.textarea}
                value={annotationGuide}
                onChange={(e) => setAnnotationGuide(e.target.value)}
                placeholder="# 类别定义&#10;..."
              />
            </label>

            <label className={styles.label}>
              可见范围
              <select
                className={styles.select}
                value={scope}
                onChange={(e) => setScope(e.target.value as TemplateScope)}
              >
                <option value="private">私有（仅自己可见）</option>
                <option value="organization">组织（同组织可见）</option>
                <option value="public" disabled={!canPickPublic}>
                  公共（全平台可见，仅超管可建）
                </option>
              </select>
              {scope === "organization" ? (
                <span className={styles.warning}>
                  组织模板需在创建后通过 PATCH 指定 organization_id（首版未提供 UI 字段）
                </span>
              ) : null}
            </label>
          </>
        )}

        {tab === "tools" && (
          <>
            <p className={styles.help}>
              工具维度独立配置类别与属性 (v0.10.17)。勾选启用工具单位, 在 Tab 内编辑.
              强隔离: 不同工具的同名类是独立记录。
            </p>
            <ToolUnitTabs
              bindings={bindings}
              activeUnit={activeUnit}
              onSelect={setActiveUnit}
              allowToggle
              onToggle={onToggleUnit}
            />
            {!activeBinding?.enabled ? (
              <p className={styles.help}>
                当前工具单位未启用 — 勾选上方复选框以启用并配置类别 / 属性。
              </p>
            ) : (
              <>
                <h4 className={styles.subheading}>类别</h4>
                <ClassEditor
                  value={activeBinding.classRows}
                  onChange={onChangeClasses}
                  max={50}
                />
                <h4 className={styles.subheading}>属性 schema</h4>
                <AttributeSchemaEditor
                  value={activeBinding.attributeFields}
                  onChange={onChangeAttributes}
                />
              </>
            )}
          </>
        )}

        {tab === "rendering" && (
          <p className={styles.help}>
            渲染配置 (snapToGrid / smoothImage / cssImageFilter / controlPointsSize) 编辑器
            在 v0.10.18 同 ProjectSettings RenderingConfigSection 抽出共享 editor 后接入,
            本版可通过应用模板后到项目设置页继续微调。
          </p>
        )}

        <div className={styles.modalActions}>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? "保存中…" : isEdit ? "保存" : "创建"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
