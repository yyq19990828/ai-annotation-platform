import { useEffect, useMemo, useRef, useState } from "react";
import type { AttributeField, AttributeSchema } from "@/api/projects";

export interface AttributeFormProps {
  schema: AttributeSchema | undefined;
  className: string;
  attributes: Record<string, unknown> | undefined;
  onChange: (next: Record<string, unknown>) => void;
  readOnly?: boolean;
}

/** 判断 field 在当前 class + 当前值组合下是否应展示。 */
function isVisible(field: AttributeField, className: string, values: Record<string, unknown>): boolean {
  const applies = field.applies_to ?? "*";
  if (applies !== "*") {
    if (!Array.isArray(applies) || !applies.includes(className)) return false;
  }
  if (field.visible_if) {
    const cur = values[field.visible_if.key];
    if (cur !== field.visible_if.equals) return false;
  }
  return true;
}

/** 列出当前 class 下所有 required 且尚未填的 field key（缺失项）。 */
export function getMissingRequired(
  schema: AttributeSchema | undefined,
  className: string,
  attributes: Record<string, unknown> | undefined,
): string[] {
  if (!schema) return [];
  const values = attributes ?? {};
  const missing: string[] = [];
  for (const f of schema.fields) {
    if (!f.required) continue;
    if (!isVisible(f, className, values)) continue;
    const v = values[f.key];
    const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
    if (empty) missing.push(f.key);
  }
  return missing;
}

export function AttributeForm({ schema, className, attributes, onChange, readOnly }: AttributeFormProps) {
  const [draft, setDraft] = useState<Record<string, unknown>>(attributes ?? {});
  const lastFromUpstream = useRef<Record<string, unknown>>(attributes ?? {});

  // 上游 attributes 变化（切选中标注 / 切类别）时同步本地 draft，避免输入残留。
  useEffect(() => {
    const next = attributes ?? {};
    if (JSON.stringify(next) !== JSON.stringify(lastFromUpstream.current)) {
      lastFromUpstream.current = next;
      setDraft(next);
    }
  }, [attributes]);

  // 防抖 400ms 上抛
  const debounceRef = useRef<number | null>(null);
  const scheduleCommit = (next: Record<string, unknown>) => {
    setDraft(next);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      onChange(next);
      debounceRef.current = null;
    }, 400) as unknown as number;
  };

  useEffect(() => () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); }, []);

  const visible = useMemo(
    () => (schema?.fields ?? []).filter((f) => isVisible(f, className, draft)),
    [schema, className, draft],
  );

  if (!schema || visible.length === 0) return null;

  const missing = getMissingRequired(schema, className, draft);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "10px 12px", borderTop: "1px solid var(--color-border)" }}>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--color-fg-muted)" }}>
        属性 {missing.length > 0 && <span style={{ color: "var(--color-danger)" }}>· {missing.length} 项必填未填</span>}
      </div>
      {visible.map((f) => {
        const v = draft[f.key];
        const isMissing = f.required && missing.includes(f.key);
        const setValue = (newV: unknown) => scheduleCommit({ ...draft, [f.key]: newV });
        const fieldStyle = {
          display: "flex", flexDirection: "column" as const, gap: 4,
          padding: 6, borderRadius: 4,
          background: isMissing ? "oklch(0.96 0.05 25 / 0.4)" : "transparent",
          border: isMissing ? "1px solid oklch(0.85 0.10 25)" : "1px solid transparent",
        };
        return (
          <label key={f.key} style={fieldStyle}>
            <span style={{ fontSize: 11.5, color: "var(--color-fg)", display: "inline-flex", alignItems: "center", gap: 6 }}>
              {f.label}
              {f.required && <span style={{ color: "var(--color-danger)", marginLeft: 4 }}>*</span>}
              {f.description && (
                <span
                  title={f.description}
                  aria-label={f.description}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    border: "1px solid var(--color-border)",
                    background: "var(--color-bg-sunken)",
                    color: "var(--color-fg-muted)",
                    fontSize: 9,
                    fontWeight: 600,
                    cursor: "help",
                  }}
                >
                  i
                </span>
              )}
              {f.hotkey && (f.type === "boolean" || f.type === "select") && (
                <span
                  className="mono"
                  title={`选中标注后按 ${f.hotkey} 切换该属性`}
                  style={{
                    padding: "0 5px",
                    background: "var(--color-bg-sunken)",
                    border: "1px solid var(--color-border)",
                    borderBottomWidth: 2,
                    borderRadius: 3,
                    fontSize: 10,
                    color: "var(--color-fg-muted)",
                    fontWeight: 500,
                  }}
                >
                  {f.hotkey}
                </span>
              )}
            </span>
            {f.type === "text" && (
              <input
                type="text"
                value={(v as string) ?? ""}
                disabled={readOnly}
                onChange={(e) => setValue(e.target.value)}
                style={inputStyle}
              />
            )}
            {f.type === "number" && (
              <input
                type="number"
                value={(v as number | string | undefined) ?? ""}
                min={f.min}
                max={f.max}
                disabled={readOnly}
                onChange={(e) => {
                  const n = e.target.value === "" ? undefined : Number(e.target.value);
                  setValue(n);
                }}
                style={inputStyle}
              />
            )}
            {f.type === "boolean" && (
              <input
                type="checkbox"
                checked={!!v}
                disabled={readOnly}
                onChange={(e) => setValue(e.target.checked)}
                style={{ alignSelf: "flex-start" }}
              />
            )}
            {f.type === "select" && (
              <select
                value={(v as string) ?? ""}
                disabled={readOnly}
                onChange={(e) => setValue(e.target.value || undefined)}
                style={inputStyle}
              >
                <option value="">—</option>
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            )}
            {f.type === "multiselect" && (
              <select
                multiple
                value={Array.isArray(v) ? (v as string[]) : []}
                disabled={readOnly}
                onChange={(e) => {
                  const arr = Array.from(e.target.selectedOptions).map((o) => o.value);
                  setValue(arr);
                }}
                style={{ ...inputStyle, height: 80 }}
              >
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            )}
            {f.type === "range" && (
              <input
                type="range"
                min={f.min ?? 0}
                max={f.max ?? 100}
                value={typeof v === "number" ? v : f.min ?? 0}
                disabled={readOnly}
                onChange={(e) => setValue(Number(e.target.value))}
              />
            )}
          </label>
        );
      })}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  fontSize: 12,
  padding: "4px 6px",
  background: "var(--color-bg-elev)",
  border: "1px solid var(--color-border)",
  borderRadius: 3,
  color: "var(--color-fg)",
};
