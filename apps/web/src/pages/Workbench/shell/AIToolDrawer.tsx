// v0.10.2 · Prompt-first ToolDock 的右侧抽屉.
// 任一 AI 工具激活时浮出, 含: 工具标题 + 后端选择器 (1:1 锁定阶段单项 disabled) +
// 工具特定控件 (smart-point 极性 / 提示文案) + Schema-form 参数面板 + 状态指示.
// 文本提示工具的输入框仍走右栏 AIPredictionPopover 的 SamTextPanel (沿用 alias 链路).

import { useEffect, useMemo } from "react";
import { Icon } from "@/components/ui/Icon";
import type { MLBackendCapability } from "@/api/ml-backends";
import type { SamPolarity, Tool } from "../state/useWorkbenchState";
import { TOOL_REGISTRY, type ToolId } from "../stage/tools";
import { SchemaForm, deriveDefaults, type JsonSchemaObject } from "../components/SchemaForm";

export interface AIToolDrawerProps {
  tool: Tool;
  /** v0.10.2 · 当前项目挂的 backend 名称 (来自 /setup.name); undefined → "未绑定". */
  backendName: string | undefined;
  capability: MLBackendCapability | undefined;
  paramsSchema: JsonSchemaObject | undefined;
  params: Record<string, unknown>;
  onSetParams: (next: Record<string, unknown>) => void;
  samPolarity: SamPolarity;
  onSetSamPolarity: (p: SamPolarity) => void;
  isLoading: boolean;
  isError: boolean;
}

const TOOL_HINT: Record<ToolId, string | null> = {
  box: null,
  hand: null,
  polygon: null,
  canvas: null,
  "smart-point": "单击图像 = 正向点；Alt+点 = 负向点",
  "smart-box": "在图像上拖框作为 SAM 提示",
  "text-prompt": "在右侧 AI 面板输入文本（按 [ ] 调阈值）",
  exemplar: "拖框圈出某个示例，后端找全图相似实例",
};

export function AIToolDrawer({
  tool,
  backendName,
  capability,
  paramsSchema,
  params,
  onSetParams,
  samPolarity,
  onSetSamPolarity,
  isLoading,
  isError,
}: AIToolDrawerProps) {
  const meta = TOOL_REGISTRY[tool];
  const hint = TOOL_HINT[tool];

  // 切工具或后端刷新 schema 时, 用 defaults 重置 params (避免上个工具的脏数据带进新工具).
  // 用 schema reference 作为 key 触发 reset, params 由父层管理.
  const defaults = useMemo(() => deriveDefaults(paramsSchema), [paramsSchema]);
  useEffect(() => {
    // 仅在 params 为空时填默认值; 否则尊重用户已编辑的值.
    if (Object.keys(params).length === 0 && Object.keys(defaults).length > 0) {
      onSetParams(defaults);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsSchema]);

  return (
    <div
      data-testid="ai-tool-drawer"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        width: 240,
        padding: "10px 12px",
        background: "var(--color-bg-elev)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        boxShadow: "var(--shadow-md)",
      }}
    >
      {/* 标题 */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Icon name={meta.icon as never} size={13} />
        <b style={{ fontSize: 12 }}>{meta.label}</b>
      </div>

      {/* 后端选择器 (1:1 阶段单项 disabled) */}
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ fontSize: 10.5, color: "var(--color-fg-muted)" }}>后端</span>
        <select
          data-testid="ai-tool-backend-select"
          value={backendName ?? ""}
          disabled
          style={{
            fontSize: 11.5,
            padding: "3px 6px",
            background: "var(--color-bg-sunken)",
            color: "var(--color-fg)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-sm)",
            opacity: 0.85,
          }}
        >
          <option value={backendName ?? ""}>
            {backendName ?? "未绑定 ML 后端"}
          </option>
        </select>
      </div>

      {/* 工具特定控件 */}
      {tool === "smart-point" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10.5, color: "var(--color-fg-muted)" }}>极性</span>
          <button
            type="button"
            data-testid="ai-tool-polarity"
            onClick={() => onSetSamPolarity(samPolarity === "positive" ? "negative" : "positive")}
            style={{
              width: 24, height: 24,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 13, fontWeight: 700,
              background:
                samPolarity === "positive"
                  ? "var(--color-success, #10b981)"
                  : "var(--color-warning, #f59e0b)",
              color: "white", border: "none", borderRadius: "50%", cursor: "pointer", lineHeight: 1,
            }}
            title={samPolarity === "positive" ? "正向 (+) — 按 - 切负向" : "负向 (−) — 按 + 切正向"}
          >
            {samPolarity === "positive" ? "+" : "−"}
          </button>
        </div>
      )}

      {hint && (
        <div
          style={{
            fontSize: 10.5,
            color: "var(--color-fg-subtle)",
            lineHeight: 1.4,
            padding: "4px 6px",
            background: "var(--color-bg-sunken)",
            borderRadius: "var(--radius-sm)",
          }}
        >
          {hint}
        </div>
      )}

      {/* 参数面板 (schema-form) */}
      {paramsSchema && Object.keys(paramsSchema.properties ?? {}).length > 0 && (
        <>
          <div style={{ borderTop: "1px solid var(--color-border-subtle, var(--color-border))" }} />
          <SchemaForm schema={paramsSchema} value={params} onChange={onSetParams} />
        </>
      )}

      {/* 状态指示 */}
      <div
        style={{
          display: "flex", alignItems: "center", gap: 4,
          fontSize: 10, color: "var(--color-fg-subtle)", marginTop: 2,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 6, height: 6, borderRadius: "50%",
            background: isError
              ? "var(--color-danger, #ef4444)"
              : isLoading
              ? "var(--color-warning, #f59e0b)"
              : capability
              ? "var(--color-success, #10b981)"
              : "var(--color-fg-subtle)",
          }}
        />
        <span>
          {isError ? "后端协商失败" : isLoading ? "加载中" : capability ? `${capability.name} v${capability.version ?? ""}` : "无能力数据"}
        </span>
      </div>
    </div>
  );
}
