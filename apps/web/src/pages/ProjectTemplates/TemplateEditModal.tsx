// v0.10.14 · E2 · 模板新建 / 编辑表单 (Modal).
// 首版只覆盖 name / description / scope / type / classes (CSV) / annotation_guide.
// 复杂字段 (attribute_schema / classes_config / rendering_config 等) 走克隆源项目
// 或后续在 ProjectSettings 拆分 section 时再补.

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

import styles from "./ProjectTemplatesPage.module.css";

interface Props {
  open: boolean;
  onClose: () => void;
  /** undefined = 新建; 给值 = 编辑. */
  initial?: ProjectTemplateOut;
}

export function TemplateEditModal({ open, onClose, initial }: Props) {
  const pushToast = useToastStore((s) => s.push);
  const { role } = usePermissions();
  const isEdit = !!initial;
  const create = useCreateProjectTemplate();
  const update = useUpdateProjectTemplate(initial?.id ?? "");

  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [scope, setScope] = useState<TemplateScope>(initial?.scope ?? "private");
  const [typeKey, setTypeKey] = useState(initial?.type_key ?? PROJECT_TYPES[0].key);
  const [classesCsv, setClassesCsv] = useState(
    (initial?.classes ?? []).join(", "),
  );
  const [annotationGuide, setAnnotationGuide] = useState(
    initial?.annotation_guide ?? "",
  );

  useEffect(() => {
    setName(initial?.name ?? "");
    setDescription(initial?.description ?? "");
    setScope(initial?.scope ?? "private");
    setTypeKey(initial?.type_key ?? PROJECT_TYPES[0].key);
    setClassesCsv((initial?.classes ?? []).join(", "));
    setAnnotationGuide(initial?.annotation_guide ?? "");
  }, [initial, open]);

  const typeLabel = useMemo(
    () =>
      PROJECT_TYPES.find((t) => t.key === typeKey)?.label ?? typeKey,
    [typeKey],
  );

  const classes = useMemo(
    () =>
      classesCsv
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    [classesCsv],
  );

  const canPickPublic = role === "super_admin";
  const submitting = create.isPending || update.isPending;

  const handleSubmit = () => {
    if (!name.trim()) {
      pushToast({ msg: "请填写模板名称", kind: "warning" });
      return;
    }
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      type_label: typeLabel,
      type_key: typeKey,
      classes,
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
    <Modal open={open} onClose={onClose} title={isEdit ? "编辑模板" : "新建模板"} width={600}>
      <div className={styles.modalBody}>
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
          类别（用英文逗号分隔）
          <textarea
            className={styles.textarea}
            value={classesCsv}
            onChange={(e) => setClassesCsv(e.target.value)}
            placeholder="car, pedestrian, traffic_sign"
          />
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
