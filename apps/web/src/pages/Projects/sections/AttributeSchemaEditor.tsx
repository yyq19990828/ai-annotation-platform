/**
 * v0.7.6 · AttributeSchemaEditor
 *
 * 从 AttributesSection 抽出的纯受控组件：负责字段增删改 + 校验。
 * 由 AttributesSection（保存按钮的薄外壳）和 CreateProjectWizard（向导 step）共用。
 *
 * 不在内部触发 PATCH 请求；调用方拿到 onChange 后的 fields 自行决定保存时机。
 */
import type { CSSProperties } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { AttributeField, AttributeFieldType } from "@/api/projects";

const labelStyle: CSSProperties = {
  display: "block", fontSize: 12, fontWeight: 500,
  color: "var(--color-fg-muted)", marginBottom: 6,
};

const inputStyle: CSSProperties = {
  boxSizing: "border-box", padding: "6px 9px", fontSize: 13,
  background: "var(--color-bg-sunken)", border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-sm)", color: "var(--color-fg)",
  outline: "none", fontFamily: "inherit",
};

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
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {value.length === 0 && (
        <div style={{ padding: 24, textAlign: "center", color: "var(--color-fg-subtle)", border: "1px dashed var(--color-border)", borderRadius: "var(--radius-md)", fontSize: 12 }}>
          {emptyHint}
        </div>
      )}

      {value.map((f, i) => (
        <div
          key={i}
          style={{
            padding: 12,
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
            background: "var(--color-bg-elev)",
            display: "flex", flexDirection: "column", gap: 8,
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 8 }}>
            <div>
              <label style={labelStyle}>key</label>
              <input value={f.key} onChange={(e) => setField(i, { key: e.target.value })} style={{ ...inputStyle, width: "100%" }} placeholder="occluded" />
            </div>
            <div>
              <label style={labelStyle}>显示名</label>
              <input value={f.label} onChange={(e) => setField(i, { label: e.target.value })} style={{ ...inputStyle, width: "100%" }} placeholder="是否遮挡" />
            </div>
            <div>
              <label style={labelStyle}>类型</label>
              <select value={f.type} onChange={(e) => setField(i, { type: e.target.value as AttributeFieldType })} style={{ ...inputStyle, width: "100%", cursor: "pointer" }}>
                {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", gap: 4, alignItems: "flex-end" }}>
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

          <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={!!f.required} onChange={(e) => setField(i, { required: e.target.checked })} />
            必填（提交质检前必须填写）
          </label>

          {(f.type === "select" || f.type === "multiselect") && (
            <div>
              <label style={labelStyle}>选项（逗号分隔，格式 value:label）</label>
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
                style={{ ...inputStyle, width: "100%" }}
              />
            </div>
          )}

          {(f.type === "number" || f.type === "range") && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <label style={labelStyle}>min</label>
                <input type="number" value={f.min ?? ""} onChange={(e) => setField(i, { min: e.target.value === "" ? undefined : Number(e.target.value) })} style={{ ...inputStyle, width: "100%" }} />
              </div>
              <div>
                <label style={labelStyle}>max</label>
                <input type="number" value={f.max ?? ""} onChange={(e) => setField(i, { max: e.target.value === "" ? undefined : Number(e.target.value) })} style={{ ...inputStyle, width: "100%" }} />
              </div>
            </div>
          )}

          <div>
            <label style={labelStyle}>仅对类别（applies_to）</label>
            <input
              value={Array.isArray(f.applies_to) ? f.applies_to.join(", ") : ""}
              onChange={(e) => {
                const v = e.target.value.trim();
                if (!v) setField(i, { applies_to: undefined });
                else setField(i, { applies_to: v.split(",").map((s) => s.trim()).filter(Boolean) });
              }}
              placeholder="留空 = 全局；如 car, truck"
              style={{ ...inputStyle, width: "100%" }}
            />
          </div>
        </div>
      ))}

      <div style={{ display: "flex", justifyContent: "flex-start" }}>
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
