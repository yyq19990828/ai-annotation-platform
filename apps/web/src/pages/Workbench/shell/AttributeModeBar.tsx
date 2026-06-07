import { useEffect, useMemo } from "react";
import type { AttributeField, AttributeSchema } from "@/api/projects";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import {
  attributeModeFields,
  defaultAttributeModeValue,
  normalizeAttributeModeState,
  type AttributeModeState,
} from "../state/attributeMode";
import styles from "./AttributeModeBar.module.css";

interface AttributeModeBarProps {
  schema: AttributeSchema | undefined;
  value: AttributeModeState;
  onChange: (next: AttributeModeState) => void;
  readOnly?: boolean;
}

function currentField(fields: AttributeField[], key: string | null): AttributeField | undefined {
  return fields.find((field) => field.key === key) ?? fields[0];
}

export function AttributeModeBar({
  schema,
  value,
  onChange,
  readOnly = false,
}: AttributeModeBarProps) {
  const fields = useMemo(() => attributeModeFields(schema), [schema]);
  const normalized = useMemo(() => normalizeAttributeModeState(value, schema), [schema, value]);
  const field = currentField(fields, normalized.fieldKey);

  useEffect(() => {
    if (
      normalized.enabled !== value.enabled
      || normalized.fieldKey !== value.fieldKey
      || normalized.currentValue !== value.currentValue
    ) {
      onChange(normalized);
    }
  }, [normalized, onChange, value]);

  if (fields.length === 0 || !field) return null;

  const setField = (fieldKey: string) => {
    const nextField = fields.find((item) => item.key === fieldKey);
    onChange({
      ...normalized,
      fieldKey,
      currentValue: defaultAttributeModeValue(nextField),
    });
  };

  const setEnabled = (enabled: boolean) => {
    onChange({ ...normalized, enabled });
  };

  return (
    <div className={styles.root} data-testid="attribute-mode-bar">
      <label className={styles.toggle}>
        <Switch
          checked={normalized.enabled}
          disabled={readOnly}
          onChange={setEnabled}
        />
        <span>属性模式</span>
      </label>
      <select
        className={styles.select}
        value={field.key}
        disabled={readOnly}
        onChange={(event) => setField(event.target.value)}
        aria-label="属性字段"
      >
        {fields.map((item) => (
          <option key={item.key} value={item.key}>{item.label}</option>
        ))}
      </select>
      {field.type === "boolean" ? (
        <Button
          size="sm"
          disabled={readOnly}
          onClick={() => onChange({ ...normalized, currentValue: !normalized.currentValue })}
        >
          {normalized.currentValue ? "是" : "否"}
        </Button>
      ) : (
        <select
          className={styles.select}
          value={field.type === "multiselect"
            ? (Array.isArray(normalized.currentValue) ? normalized.currentValue[0] ?? "" : "")
            : String(normalized.currentValue ?? "")}
          disabled={readOnly}
          onChange={(event) => {
            const nextValue = field.type === "multiselect"
              ? (event.target.value ? [event.target.value] : [])
              : event.target.value || undefined;
            onChange({ ...normalized, currentValue: nextValue });
          }}
          aria-label="属性值"
        >
          <option value="">—</option>
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      )}
    </div>
  );
}
