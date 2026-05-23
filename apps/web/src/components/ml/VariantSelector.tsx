import type {
  MLBackendSupportedVariantGroup,
  MLBackendSupportedVariantOption,
} from "@/api/ml-backends";
import {
  VARIANT_FIELD_KEYS,
  type JsonSchemaField,
  type JsonSchemaObject,
} from "@/pages/Workbench/components/SchemaForm";
import styles from "./VariantSelector.module.css";

interface VariantSelectorProps {
  schema?: JsonSchemaObject;
  supportedVariants?: MLBackendSupportedVariantGroup[];
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  disabled?: boolean;
}

interface NormalizedVariantField {
  key: string;
  title: string;
  description?: string;
  fallback: string;
  options: MLBackendSupportedVariantOption[];
}

function asField(raw: unknown): JsonSchemaField | null {
  return raw && typeof raw === "object" ? (raw as JsonSchemaField) : null;
}

function optionLabel(option: MLBackendSupportedVariantOption) {
  const meta = [
    option.vram_gb != null ? `${option.vram_gb}GB` : null,
    option.tier ? tierLabel(option.tier) : null,
    option.recommended ? "推荐" : null,
  ].filter(Boolean);
  return meta.length > 0
    ? `${option.label ?? option.value} · ${meta.join(" · ")}`
    : option.label ?? option.value;
}

function tierLabel(tier: string) {
  if (tier === "fast") return "快速";
  if (tier === "balanced") return "均衡";
  if (tier === "accurate") return "精度";
  return tier;
}

function tierClass(tier: string | undefined) {
  if (tier === "fast") return styles.tierFast;
  if (tier === "balanced") return styles.tierBalanced;
  if (tier === "accurate") return styles.tierAccurate;
  return undefined;
}

function normalizeOptions(raw: MLBackendSupportedVariantOption[] | undefined) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is MLBackendSupportedVariantOption => {
    return item != null && typeof item === "object" && typeof item.value === "string";
  });
}

function normalizeFields(
  schema: JsonSchemaObject | undefined,
  supportedVariants: MLBackendSupportedVariantGroup[] | undefined,
): NormalizedVariantField[] {
  const richByKey = new Map<string, MLBackendSupportedVariantGroup>();
  for (const group of supportedVariants ?? []) {
    if (group && typeof group.key === "string") richByKey.set(group.key, group);
  }

  const fields: NormalizedVariantField[] = [];
  for (const key of VARIANT_FIELD_KEYS) {
    const schemaField = asField(schema?.properties?.[key]);
    const rich = richByKey.get(key);
    const richOptions = normalizeOptions(rich?.variants);
    const enumOptions: MLBackendSupportedVariantOption[] = Array.isArray(schemaField?.enum)
      ? schemaField.enum.map((value) => ({ value, label: value }))
      : [];
    const options = richOptions.length > 0 ? richOptions : enumOptions;
    if (options.length === 0) continue;
    fields.push({
      key,
      title: rich?.title ?? schemaField?.title ?? key,
      description: rich?.description ?? schemaField?.description,
      fallback: typeof schemaField?.default === "string" ? schemaField.default : options[0]!.value,
      options,
    });
  }
  return fields;
}

export function VariantSelector({
  schema,
  supportedVariants,
  value,
  onChange,
  disabled = false,
}: VariantSelectorProps) {
  const fields = normalizeFields(schema, supportedVariants);
  if (fields.length === 0) return null;

  return (
    <div data-testid="ai-variant-selector" className={styles.root}>
      {fields.map((field) => {
        const current = typeof value[field.key] === "string"
          ? (value[field.key] as string)
          : field.fallback;
        const selected = field.options.find((option) => option.value === current) ?? field.options[0]!;
        const note = selected.note ?? field.description;
        const hasMeta = selected.vram_gb != null || Boolean(selected.tier) || Boolean(selected.recommended);
        return (
          <div key={field.key} className={styles.field}>
            <div className={styles.fieldHeader}>
              <span className={styles.label}>{field.title}</span>
            </div>
            <select
              data-testid={`ai-variant-${field.key}`}
              value={selected.value}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, [field.key]: e.target.value })}
              className={styles.select}
            >
              {field.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {optionLabel(option)}
                </option>
              ))}
            </select>
            {hasMeta && (
              <div className={styles.metaRow}>
                {selected.vram_gb != null && (
                  <span className={styles.pill}>显存约 {selected.vram_gb}GB</span>
                )}
                {selected.tier && (
                  <span className={`${styles.pill} ${tierClass(selected.tier) ?? ""}`}>
                    {tierLabel(selected.tier)}
                  </span>
                )}
                {selected.recommended && (
                  <span className={`${styles.pill} ${styles.recommended}`}>推荐</span>
                )}
              </div>
            )}
            {note && <span className={styles.note}>{note}</span>}
          </div>
        );
      })}
    </div>
  );
}
