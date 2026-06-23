/**
 * v0.18.0 · 从 ML Backend 导入属性 schema
 *
 * 二阶段 backend (如 onnxtools 车辆属性) 在 /setup 自报 output_attribute_schema —— 声明
 * /predict 会写入哪些 attributes (vehicle_type / color 等, 含 select options)。本对话框列出
 * 所有「有输出属性」的 backend / model, 让用户选一个并勾选要导入的字段, 一键合并进当前工具
 * 单位的 attribute_schema, 免去手抄选项 + key 对齐。
 *
 * 纯受控: 确认后回调 onImport(fields), 由调用方 (ClassesSection) 决定如何与现有属性合并。
 */
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import {
  useCapabilityInstances,
  type CapabilityInstance,
  type CapabilityInstanceModel,
  type OutputAttributeSchemaItem,
} from "@/api/mlCapabilities";
import type { AttributeField, AttributeFieldType } from "@/api/projects";

const FIELD_TYPE_LABEL: Record<string, string> = {
  text: "文本",
  number: "数字",
  boolean: "开关",
  select: "下拉单选",
  multiselect: "下拉多选",
  range: "区间滑杆",
};
const ALLOWED_TYPES: AttributeFieldType[] = [
  "text",
  "number",
  "boolean",
  "select",
  "multiselect",
  "range",
];

function itemToField(item: OutputAttributeSchemaItem): AttributeField {
  const type = (ALLOWED_TYPES as string[]).includes(item.type)
    ? (item.type as AttributeFieldType)
    : "text";
  const field: AttributeField = {
    key: item.key,
    label: item.label || item.key,
    type,
    required: false,
  };
  if (item.options?.length) {
    field.options = item.options.map((o) => ({ value: o.value, label: o.label }));
  }
  return field;
}

interface ModelEntry {
  backendName: string;
  model: CapabilityInstanceModel;
  schema: OutputAttributeSchemaItem[];
}

function collectEntries(instances: CapabilityInstance[]): ModelEntry[] {
  const out: ModelEntry[] = [];
  for (const inst of instances) {
    for (const model of inst.models) {
      const schema = model.output_attribute_schema ?? [];
      if (schema.length > 0) {
        out.push({ backendName: inst.name, model, schema });
      }
    }
  }
  return out;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** 用户确认导入的字段（已按勾选过滤、映射成 AttributeField）。 */
  onImport: (fields: AttributeField[]) => void;
  /** 当前工具单位名（仅用于文案提示）。 */
  targetUnitLabel: string;
}

export function ImportAttributesFromBackendDialog({
  open,
  onClose,
  onImport,
  targetUnitLabel,
}: Props) {
  const { data, isLoading, isError } = useCapabilityInstances();
  const entries = useMemo(
    () => (data ? collectEntries(data.instances) : []),
    [data],
  );

  // 选中的 model（backendName + model.id 唯一）与勾选的字段 key 集合。
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(new Set());

  const selected = useMemo(
    () =>
      entries.find((e) => `${e.backendName}::${e.model.id}` === selectedId) ??
      null,
    [entries, selectedId],
  );

  const selectEntry = (entry: ModelEntry) => {
    setSelectedId(`${entry.backendName}::${entry.model.id}`);
    // 默认全选可导入字段。
    setCheckedKeys(new Set(entry.schema.map((s) => s.key)));
  };

  const toggleKey = (key: string) => {
    setCheckedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleImport = () => {
    if (!selected) return;
    const fields = selected.schema
      .filter((s) => checkedKeys.has(s.key))
      .map(itemToField);
    if (fields.length === 0) return;
    onImport(fields);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="从 ML Backend 导入属性" width={640}>
      <div className="flex flex-col gap-3">
        <p className="m-0 text-xs leading-normal text-muted-foreground">
          二阶段 backend 会自报它写入的属性字段（如车型 / 颜色，含下拉选项）。选择一个模型，
          勾选要导入的字段，即可合并进「{targetUnitLabel}」工具单位的属性 schema（同 key 覆盖、
          新增追加）。
        </p>

        {isLoading && (
          <div className="rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
            正在加载 ML Backend 实例…
          </div>
        )}
        {isError && (
          <div className="rounded-md border border-dashed border-border p-6 text-center text-xs text-status-danger">
            加载 ML Backend 实例失败，请稍后重试。
          </div>
        )}
        {!isLoading && !isError && entries.length === 0 && (
          <div className="rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
            当前没有任何在线 backend 自报输出属性 schema。需要二阶段 backend（如 onnxtools
            车辆属性）上线后才能导入。
          </div>
        )}

        {entries.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-muted-foreground">
              选择模型
            </span>
            <div className="flex flex-col gap-1.5">
              {entries.map((entry) => {
                const id = `${entry.backendName}::${entry.model.id}`;
                const active = id === selectedId;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => selectEntry(entry)}
                    className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-left transition-colors ${
                      active
                        ? "border-primary bg-primary/10"
                        : "border-border bg-card hover:bg-muted"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {entry.model.display_name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {entry.backendName} · {entry.schema.length} 个属性
                      </span>
                    </span>
                    {active && (
                      <Icon name="check" size={14} className="text-brand" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {selected && (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-muted-foreground">
              字段预览（勾选要导入的）
            </span>
            <div className="flex flex-col gap-1.5">
              {selected.schema.map((item) => {
                const checked = checkedKeys.has(item.key);
                return (
                  <label
                    key={item.key}
                    className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-card p-2.5"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleKey(item.key)}
                      className="mt-0.5"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-medium text-foreground">
                          {item.label || item.key}
                        </span>
                        <code className="rounded-sm bg-muted px-1 py-0.5 text-2xs text-muted-foreground">
                          {item.key}
                        </code>
                        <span className="text-2xs text-muted-foreground">
                          {FIELD_TYPE_LABEL[item.type] ?? item.type}
                        </span>
                      </span>
                      {item.options?.length ? (
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {item.options.length} 个选项：
                          {item.options
                            .slice(0, 8)
                            .map((o) => o.label)
                            .join(" / ")}
                          {item.options.length > 8 ? " …" : ""}
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={!selected || checkedKeys.size === 0}
            onClick={handleImport}
          >
            导入选中字段
          </Button>
        </div>
      </div>
    </Modal>
  );
}
