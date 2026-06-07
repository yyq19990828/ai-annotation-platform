import type { AttributeField, AttributeSchema } from "@/api/projects";
import type { AnnotationResponse } from "@/types";

export interface AttributeModeState {
  enabled: boolean;
  fieldKey: string | null;
  currentValue: unknown;
}

export const DEFAULT_ATTRIBUTE_MODE: AttributeModeState = {
  enabled: false,
  fieldKey: null,
  currentValue: undefined,
};

export function isAttributeModeField(field: AttributeField): boolean {
  return field.type === "boolean" || field.type === "select" || field.type === "multiselect";
}

export function attributeModeFields(schema: AttributeSchema | undefined): AttributeField[] {
  return (schema?.fields ?? []).filter(isAttributeModeField);
}

export function fieldAppliesToClass(field: AttributeField, className: string): boolean {
  const applies = field.applies_to ?? "*";
  return applies === "*" || (Array.isArray(applies) && applies.includes(className));
}

export function defaultAttributeModeValue(field: AttributeField | undefined): unknown {
  if (!field) return undefined;
  if (field.type === "boolean") return true;
  const first = field.options?.[0]?.value;
  if (field.type === "multiselect") return first ? [first] : [];
  return first;
}

export function normalizeAttributeModeState(
  state: AttributeModeState,
  schema: AttributeSchema | undefined,
): AttributeModeState {
  const fields = attributeModeFields(schema);
  if (fields.length === 0) return { ...DEFAULT_ATTRIBUTE_MODE };
  const field = fields.find((item) => item.key === state.fieldKey) ?? fields[0];
  const currentValue = state.fieldKey === field.key && state.currentValue !== undefined
    ? state.currentValue
    : defaultAttributeModeValue(field);
  return {
    enabled: state.enabled,
    fieldKey: field.key,
    currentValue,
  };
}

export function canApplyAttributeModeToAnnotation(
  annotation: AnnotationResponse,
  field: AttributeField | undefined,
): boolean {
  if (!field || !isAttributeModeField(field)) return false;
  if (!fieldAppliesToClass(field, annotation.class_name)) return false;
  return annotation.geometry.type === "bbox"
    || annotation.geometry.type === "polygon"
    || annotation.geometry.type === "multi_polygon"
    || annotation.geometry.type === "rotated_bbox";
}

export function applyAttributeModeValue(
  attributes: Record<string, unknown> | undefined,
  field: AttributeField,
  value: unknown,
): Record<string, unknown> {
  const next = { ...(attributes ?? {}) };
  if (field.type === "boolean") {
    next[field.key] = Boolean(value);
  } else if (field.type === "multiselect") {
    next[field.key] = Array.isArray(value) ? value : value === undefined ? [] : [String(value)];
  } else {
    next[field.key] = value === "" ? undefined : value;
  }
  return next;
}
