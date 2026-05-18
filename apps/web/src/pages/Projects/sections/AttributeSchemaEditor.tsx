/**
 * v0.7.6 · AttributeSchemaEditor
 *
 * 从 AttributesSection 抽出的纯受控组件：负责字段增删改 + 校验。
 * 由 AttributesSection（保存按钮的薄外壳）和 CreateProjectWizard（向导 step）共用。
 *
 * 不在内部触发 PATCH 请求；调用方拿到 onChange 后的 fields 自行决定保存时机。
 */
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { AttributeField, AttributeFieldType } from "@/api/projects";
import styles from "./AttributeSchemaEditor.module.css";

const FIELD_TYPES: { value: AttributeFieldType; label: string }[] = [
  { value: "text", label: "文本" },
  { value: "number", label: "数字" },
  { value: "boolean", label: "勾选" },
  { value: "select", label: "下拉单选" },
  { value: "multiselect", label: "下拉多选" },
  { value: "range", label: "区间滑杆" },
];

export function newAttributeField(): AttributeField {
  return { key: "", label: "", type: "text", required: false };
}

interface Props {
  value: AttributeField[];
  onChange: (next: AttributeField[]) => void;
  /** 空状态提示文案 */
  emptyHint?: string;
}

export function AttributeSchemaEditor({
  value,
  onChange,
  emptyHint = "尚未配置任何属性",
}: Props) {
  const setField = (i: number, patch: Partial<AttributeField>) =>
    onChange(value.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));

  const moveField = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= value.length) return;
    const out = value.slice();
    [out[i], out[j]] = [out[j], out[i]];
    onChange(out);
  };

  const removeField = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const addField = () => onChange([...value, newAttributeField()]);

  return (
    <div className={styles.root}>
      {value.length === 0 && (
        <div className={styles.emptyState}>
          {emptyHint}
        </div>
      )}

      {value.map((f, i) => (
        <div key={i} className={styles.fieldCard}>
          <div className={styles.fieldGrid}>
            <div>
              <label className={styles.label}>key</label>
              <input value={f.key} onChange={(e) => setField(i, { key: e.target.value })} className={styles.control} placeholder="occluded" />
            </div>
            <div>
              <label className={styles.label}>显示名</label>
              <input value={f.label} onChange={(e) => setField(i, { label: e.target.value })} className={styles.control} placeholder="是否遮挡" />
            </div>
            <div>
              <label className={styles.label}>类型</label>
              <select value={f.type} onChange={(e) => setField(i, { type: e.target.value as AttributeFieldType })} className={`${styles.control} ${styles.selectControl}`}>
                {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className={styles.rowActions}>
              <Button size="sm" variant="ghost" onClick={() => moveField(i, -1)} disabled={i === 0} title="上移">
                <Icon name="chevUp" size={11} />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => moveField(i, 1)} disabled={i === value.length - 1} title="下移">
                <Icon name="chevDown" size={11} />
              </Button>
              <Button size="sm" variant="danger" onClick={() => removeField(i)} title="删除">
                <Icon name="trash" size={11} />
              </Button>
            </div>
          </div>

          <label className={styles.checkboxLabel}>
            <input type="checkbox" checked={!!f.required} onChange={(e) => setField(i, { required: e.target.checked })} />
            必填（提交质检前必须填写）
          </label>

          {(f.type === "select" || f.type === "multiselect") && (
            <div>
              <label className={styles.label}>选项（逗号分隔，格式 value:label）</label>
              <input
                value={(f.options ?? []).map((o) => `${o.value}:${o.label}`).join(", ")}
                onChange={(e) => {
                  const parts = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                  const opts = parts.map((p) => {
                    const [v, l] = p.split(":").map((x) => x.trim());
                    return { value: v, label: l || v };
                  });
                  setField(i, { options: opts });
                }}
                placeholder="yes:是, no:否"
                className={styles.control}
              />
            </div>
          )}

          {(f.type === "number" || f.type === "range") && (
            <div className={styles.twoColumnGrid}>
              <div>
                <label className={styles.label}>min</label>
                <input type="number" value={f.min ?? ""} onChange={(e) => setField(i, { min: e.target.value === "" ? undefined : Number(e.target.value) })} className={styles.control} />
              </div>
              <div>
                <label className={styles.label}>max</label>
                <input type="number" value={f.max ?? ""} onChange={(e) => setField(i, { max: e.target.value === "" ? undefined : Number(e.target.value) })} className={styles.control} />
              </div>
            </div>
          )}

          <div>
            <label className={styles.label}>仅对类别（applies_to）</label>
            <input
              value={Array.isArray(f.applies_to) ? f.applies_to.join(", ") : ""}
              onChange={(e) => {
                const v = e.target.value.trim();
                if (!v) setField(i, { applies_to: undefined });
                else setField(i, { applies_to: v.split(",").map((s) => s.trim()).filter(Boolean) });
              }}
              placeholder="留空 = 全局；如 car, truck"
              className={styles.control}
            />
          </div>
        </div>
      ))}

      <div className={styles.footer}>
        <Button variant="ghost" onClick={addField}>
          <Icon name="plus" size={12} />新增属性
        </Button>
      </div>
    </div>
  );
}

/** 共享校验逻辑，调用方在保存 / 进入下一步前调一次。返回错误描述或 null。*/
export function validateAttributeFields(fields: AttributeField[]): string | null {
  const seen = new Set<string>();
  for (const f of fields) {
    if (!f.key.trim()) return "属性 key 不能为空";
    if (seen.has(f.key)) return `属性 key 重复: ${f.key}`;
    seen.add(f.key);
    if ((f.type === "select" || f.type === "multiselect") && (!f.options || f.options.length === 0)) {
      return `${f.label || f.key} 需要至少 1 个选项`;
    }
  }
  return null;
}
