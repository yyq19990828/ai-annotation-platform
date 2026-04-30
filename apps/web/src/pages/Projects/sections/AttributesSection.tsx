import { useEffect, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Card } from "@/components/ui/Card";
import { useToastStore } from "@/components/ui/Toast";
import { useUpdateProject } from "@/hooks/useProjects";
import type { ProjectResponse, AttributeField, AttributeFieldType, AttributeSchema } from "@/api/projects";

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

function newField(): AttributeField {
  return { key: "", label: "", type: "text", required: false };
}

export function AttributesSection({ project }: { project: ProjectResponse }) {
  const pushToast = useToastStore((s) => s.push);
  const update = useUpdateProject(project.id);
  const initial = project.attribute_schema?.fields ?? [];
  const [fields, setFields] = useState<AttributeField[]>(initial);

  useEffect(() => {
    setFields(project.attribute_schema?.fields ?? []);
  }, [project.id, project.attribute_schema]);

  const setField = (i: number, patch: Partial<AttributeField>) => {
    setFields((s) => s.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  };

  const moveField = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= fields.length) return;
    setFields((s) => {
      const out = s.slice();
      [out[i], out[j]] = [out[j], out[i]];
      return out;
    });
  };

  const removeField = (i: number) => setFields((s) => s.filter((_, idx) => idx !== i));
  const addField = () => setFields((s) => [...s, newField()]);

  const dirty = JSON.stringify(fields) !== JSON.stringify(initial);

  const onSave = () => {
    // 校验：key 必填、唯一；select/multiselect 至少 1 个 option
    const seen = new Set<string>();
    for (const f of fields) {
      if (!f.key.trim()) {
        pushToast({ msg: "属性 key 不能为空", kind: "error" });
        return;
      }
      if (seen.has(f.key)) {
        pushToast({ msg: `属性 key 重复: ${f.key}`, kind: "error" });
        return;
      }
      seen.add(f.key);
      if ((f.type === "select" || f.type === "multiselect") && (!f.options || f.options.length === 0)) {
        pushToast({ msg: `${f.label || f.key} 需要至少 1 个选项`, kind: "error" });
        return;
      }
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

        {fields.length === 0 && (
          <div style={{ padding: 24, textAlign: "center", color: "var(--color-fg-subtle)", border: "1px dashed var(--color-border)", borderRadius: "var(--radius-md)" }}>
            尚未配置任何属性
          </div>
        )}

        {fields.map((f, i) => (
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
                <Button size="sm" variant="ghost" onClick={() => moveField(i, 1)} disabled={i === fields.length - 1} title="下移">
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

        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <Button variant="ghost" onClick={addField}>
            <Icon name="plus" size={12} />新增属性
          </Button>
          <Button variant="primary" disabled={!dirty || update.isPending} onClick={onSave}>
            {update.isPending ? "保存中..." : "保存"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
