// v0.10.2 · 最小 JSON Schema 表单 (Draft-07 子集).
// 支持类型: number / integer / boolean / string (含 enum).
// 不依赖 @rjsf/core 以节省 ~50KB bundle; array / nested object 后续按需扩展.

import { useMemo } from "react";

export interface JsonSchemaField {
  type?: "number" | "integer" | "boolean" | "string";
  title?: string;
  description?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  enum?: string[];
}

export interface JsonSchemaObject {
  type?: string;
  /**
   * v0.10.2 · 与后端 `/setup.params.properties` 同形, 因来自 unknown JSON 故宽容地用 unknown.
   * 内部按 JsonSchemaField 子集解释; 不匹配的字段渲染为 text input fallback.
   */
  properties?: Record<string, unknown>;
}

function asField(v: unknown): JsonSchemaField {
  if (v && typeof v === "object") return v as JsonSchemaField;
  return {};
}

export interface SchemaFormProps {
  schema: JsonSchemaObject | undefined;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  /** v0.10.2 · 整组 disabled, AI 工具不可用时灰显. */
  disabled?: boolean;
}

/** 从 schema.properties 派生 defaults; 用于 AIToolDrawer 切换工具时 reset. */
export function deriveDefaults(schema: JsonSchemaObject | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!schema?.properties) return out;
  for (const [key, raw] of Object.entries(schema.properties)) {
    const field = asField(raw);
    if (field.default !== undefined) out[key] = field.default;
  }
  return out;
}

export function SchemaForm({ schema, value, onChange, disabled = false }: SchemaFormProps) {
  const entries = useMemo(
    () => (schema?.properties ? Object.entries(schema.properties) : []),
    [schema],
  );
  if (entries.length === 0) {
    return (
      <div
        data-testid="schema-form-empty"
        style={{ fontSize: 11, color: "var(--color-fg-subtle)", padding: "6px 0" }}
      >
        当前后端无可配置参数
      </div>
    );
  }
  const setField = (key: string, next: unknown) => {
    onChange({ ...value, [key]: next });
  };
  return (
    <div data-testid="schema-form" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {entries.map(([key, raw]) => (
        <SchemaField
          key={key}
          name={key}
          field={asField(raw)}
          value={value[key]}
          disabled={disabled}
          onChange={(v) => setField(key, v)}
        />
      ))}
    </div>
  );
}

interface SchemaFieldProps {
  name: string;
  field: JsonSchemaField;
  value: unknown;
  disabled: boolean;
  onChange: (next: unknown) => void;
}

function SchemaField({ name, field, value, disabled, onChange }: SchemaFieldProps) {
  const title = field.title ?? name;
  const labelStyle = { fontSize: 11, color: "var(--color-fg-muted)" };

  if (field.type === "boolean") {
    const v = typeof value === "boolean" ? value : Boolean(field.default ?? false);
    return (
      <label
        data-testid={`schema-field-${name}`}
        style={{ display: "flex", alignItems: "center", gap: 6, cursor: disabled ? "not-allowed" : "pointer" }}
      >
        <input
          type="checkbox"
          checked={v}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span style={labelStyle}>{title}</span>
      </label>
    );
  }

  if (field.type === "string" && Array.isArray(field.enum) && field.enum.length > 0) {
    const v = typeof value === "string" ? value : String(field.default ?? field.enum[0]);
    return (
      <div data-testid={`schema-field-${name}`} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={labelStyle}>{title}</span>
        <select
          value={v}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          style={{
            fontSize: 12,
            padding: "4px 6px",
            background: "var(--color-bg-elev)",
            color: "var(--color-fg)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-sm)",
          }}
        >
          {field.enum.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>
    );
  }

  if (field.type === "number" || field.type === "integer") {
    const isInt = field.type === "integer";
    const def = typeof field.default === "number" ? field.default : 0;
    const v = typeof value === "number" ? value : def;
    const min = field.minimum;
    const max = field.maximum;
    const step = isInt ? 1 : (max != null && min != null ? (max - min) / 100 : 0.01);
    const hasRange = min != null && max != null;
    return (
      <div data-testid={`schema-field-${name}`} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={labelStyle}>{title}</span>
          <span className="mono" style={{ fontSize: 11, color: "var(--color-fg)" }}>
            {isInt ? v : Number(v).toFixed(2)}
          </span>
        </div>
        {hasRange && (
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={v}
            disabled={disabled}
            onChange={(e) => onChange(isInt ? parseInt(e.target.value, 10) : parseFloat(e.target.value))}
            style={{ width: "100%" }}
          />
        )}
        {!hasRange && (
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={v}
            disabled={disabled}
            onChange={(e) => onChange(isInt ? parseInt(e.target.value, 10) : parseFloat(e.target.value))}
            style={{
              fontSize: 12,
              padding: "4px 6px",
              background: "var(--color-bg-elev)",
              color: "var(--color-fg)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-sm)",
            }}
          />
        )}
      </div>
    );
  }

  // string (no enum) → text input
  const v = typeof value === "string" ? value : String(field.default ?? "");
  return (
    <div data-testid={`schema-field-${name}`} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={labelStyle}>{title}</span>
      <input
        type="text"
        value={v}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={{
          fontSize: 12,
          padding: "4px 6px",
          background: "var(--color-bg-elev)",
          color: "var(--color-fg)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-sm)",
        }}
      />
    </div>
  );
}
