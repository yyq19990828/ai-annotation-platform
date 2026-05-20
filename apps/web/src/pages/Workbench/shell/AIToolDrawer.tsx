// v0.10.2 · Prompt-first ToolDock 的右侧抽屉.
// 任一 AI 工具激活时浮出, 含: 工具标题 + 后端选择器 (1:1 锁定阶段单项 disabled) +
// 工具特定控件 (smart-point 极性 / 提示文案) + Schema-form 参数面板 + 状态指示.
// v0.10.23 · 设计 B · text-prompt 工具的输入段 (SamTextPanel) 下沉到此处, 替换原 hint;
// 预测结果列表仍留右栏 AIInspectorPanel.

import { useEffect, useMemo } from "react";
import { Icon } from "@/components/ui/Icon";
import type { MLBackendCapability } from "@/api/ml-backends";
import type { SamPolarity, Tool } from "../state/useWorkbenchState";
import type { TextOutputMode } from "../state/useInteractiveAI";
import { TOOL_REGISTRY, type ToolId } from "../stage/tools";
import { SchemaForm, deriveDefaults, type JsonSchemaObject } from "../components/SchemaForm";
import { SamTextPanel } from "./SamTextPanel";
import styles from "./AIToolDrawer.module.css";

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
  // v0.10.23 · 设计 B · text-prompt 输入段下沉到 drawer; 沿用现有 runText 链路 (逻辑零改).
  onRunSamText?: (text: string, outputMode: TextOutputMode) => void;
  samRunning?: boolean;
  samCandidateCount?: number;
  projectId?: string;
  projectTypeKey?: string | null;
  samTextFocusKey?: number;
}

const TOOL_HINT: Record<ToolId, string | null> = {
  box: null,
  "rotated-box": null,
  hand: null,
  polygon: null,
  canvas: null,
  mask: null,
  "smart-point": "单击图像 = 正向点；Alt+点 = 负向点",
  "smart-box": "在图像上拖框作为 SAM 提示",
  // v0.10.23 · 设计 B · text-prompt 不再用 hint, 改在下方渲染 SamTextPanel 输入段.
  "text-prompt": null,
  exemplar: "拖框圈出某个示例，后端找全图相似实例",
  // v0.10.17 · Magic Box: 复用 SAM bbox prompt 把粗框收紧到对象紧凑外接矩形.
  "magic-box": "粗略拖框 → SAM 返回 mask → 取紧凑外接矩形落 bbox",
};

function cn(...xs: Array<string | false | null | undefined>): string {
  return xs.filter(Boolean).join(" ");
}

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
  onRunSamText,
  samRunning,
  samCandidateCount,
  projectId,
  projectTypeKey,
  samTextFocusKey,
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
      data-ai-drawer-root
      className={styles.drawer}
    >
      {/* 标题 */}
      <div className={styles.titleRow}>
        <Icon name={meta.icon as never} size={13} />
        <b className={styles.title}>{meta.label}</b>
      </div>

      {/* 后端选择器 (1:1 阶段单项 disabled) */}
      <div className={styles.field}>
        <span className={styles.label}>后端</span>
        <select
          data-testid="ai-tool-backend-select"
          value={backendName ?? ""}
          disabled
          className={styles.backendSelect}
        >
          <option value={backendName ?? ""}>
            {backendName ?? "未绑定 ML 后端"}
          </option>
        </select>
      </div>

      {/* 工具特定控件 */}
      {tool === "smart-point" && (
        <div className={styles.polarityRow}>
          <span className={styles.label}>极性</span>
          <button
            type="button"
            data-testid="ai-tool-polarity"
            onClick={() => onSetSamPolarity(samPolarity === "positive" ? "negative" : "positive")}
            className={cn(
              styles.polarityButton,
              samPolarity === "positive" ? styles.polarityPositive : styles.polarityNegative,
            )}
            title={samPolarity === "positive" ? "正向 (+) — 按 - 切负向" : "负向 (−) — 按 + 切正向"}
          >
            {samPolarity === "positive" ? "+" : "−"}
          </button>
        </div>
      )}

      {hint && (
        <div className={styles.hint}>
          {hint}
        </div>
      )}

      {/* v0.10.23 · 设计 B · text-prompt 输入段下沉到此处 (文本框 + 输出模式 + 「找全图」). */}
      {tool === "text-prompt" && onRunSamText && (
        <SamTextPanel
          onRun={onRunSamText}
          running={samRunning ?? false}
          candidateCount={samCandidateCount ?? 0}
          projectId={projectId}
          projectTypeKey={projectTypeKey}
          focusKey={samTextFocusKey}
        />
      )}

      {/* 参数面板 (schema-form) */}
      {paramsSchema && Object.keys(paramsSchema.properties ?? {}).length > 0 && (
        <>
          <div className={styles.separator} />
          <SchemaForm schema={paramsSchema} value={params} onChange={onSetParams} />
        </>
      )}

      {/* 状态指示 */}
      <div className={styles.statusRow}>
        <span
          aria-hidden
          className={cn(
            styles.statusDot,
            isError
              ? styles.statusError
              : isLoading
                ? styles.statusLoading
                : capability
                  ? styles.statusReady
                  : styles.statusIdle,
          )}
        />
        <span>
          {isError ? "后端协商失败" : isLoading ? "加载中" : capability ? `${capability.name} v${capability.version ?? ""}` : "无能力数据"}
        </span>
      </div>
    </div>
  );
}
