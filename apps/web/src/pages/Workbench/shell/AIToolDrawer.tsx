// v0.10.2 · Prompt-first ToolDock 的右侧抽屉.
// 任一 AI 工具激活时浮出, 含: 工具标题 + 后端选择器 (1:1 锁定阶段单项 disabled) +
// 工具特定控件 (smart-point 极性 / 提示文案) + Schema-form 参数面板 + 状态指示.
// v0.10.23 · 设计 B · text-prompt 工具的输入段 (SamTextPanel) 下沉到此处, 替换原 hint;
// 预测结果列表仍留右栏 AIInspectorPanel.

import { Icon } from "@/components/ui/Icon";
import type { MLBackendCapability, MLModelCapability } from "@/api/ml-backends";
import type { SamPolarity, Tool } from "../state/useWorkbenchState";
import type { TextOutputMode } from "../state/useInteractiveAI";
import type { CapabilityWarning } from "../state/useCapabilityValidation";
import { TOOL_REGISTRY, type ToolId } from "../stage/tools";
import { SamTextPanel } from "./SamTextPanel";
import { SamOutputModeTabs } from "./SamOutputModeTabs";
import styles from "./AIToolDrawer.module.css";

export interface AIToolDrawerProps {
  tool: Tool;
  /** v0.10.2 · 当前项目挂的 backend 名称 (来自 /setup.name); undefined → "未绑定". */
  backendName: string | undefined;
  capability: MLBackendCapability | undefined;
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
  // exemplar 工具输出形态 (box/mask/both), 对齐 text-prompt; 会话级状态由 WorkbenchShell 持有.
  exemplarOutputMode?: TextOutputMode;
  onSetExemplarOutputMode?: (mode: TextOutputMode) => void;
  // v0.14.9 · 能力声明协议 v2 · 多模型选择. models 长度 <= 1 时**不渲染**选择器 (向后兼容).
  models?: MLModelCapability[];
  activeModelId?: string;
  onSetActiveModelId?: (id: string) => void;
  // v0.14.9 · active model 与项目配置的兼容性警告 (非阻断). 空数组时不渲染。
  capabilityWarnings?: CapabilityWarning[];
}

// v0.14.9 · model.task → 中文分组标题. 受控 task 之外的归「其他」。
const MODEL_TASK_LABELS: Record<string, string> = {
  detection: "检测",
  obb: "旋转框检测",
  segmentation: "分割",
  keypoint: "关键点",
  classification: "分类",
  ocr: "文字识别",
  doc_layout: "版面分析",
  tracker: "视频追踪",
  interactive_seg: "交互式分割",
};

function modelTaskLabel(task: string | undefined): string {
  if (!task) return "其他";
  return MODEL_TASK_LABELS[task] ?? "其他";
}

// v0.14.9 · 按 task 把 models 分桶, 保持各 task 内的原始顺序; 返回 [task, models[]] 列表。
function groupModelsByTask(
  models: MLModelCapability[],
): Array<[string, MLModelCapability[]]> {
  const order: string[] = [];
  const buckets = new Map<string, MLModelCapability[]>();
  for (const m of models) {
    const task = m.task ?? "";
    if (!buckets.has(task)) {
      buckets.set(task, []);
      order.push(task);
    }
    buckets.get(task)!.push(m);
  }
  return order.map((task) => [task, buckets.get(task)!]);
}

const TOOL_HINT: Record<ToolId, string | null> = {
  box: null,
  "rotated-box": null,
  hand: null,
  polygon: null,
  polyline: null,
  keypoint: null,
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
  exemplarOutputMode,
  onSetExemplarOutputMode,
  models,
  activeModelId,
  onSetActiveModelId,
  capabilityWarnings,
}: AIToolDrawerProps) {
  const meta = TOOL_REGISTRY[tool];
  const hint = TOOL_HINT[tool];

  // v0.14.9 · 多模型选择器: 仅 models 长度 > 1 时渲染 (单模型 / 老 backend 完全维持现状)。
  const modelList = models ?? [];
  const showModelSelector = modelList.length > 1 && !!onSetActiveModelId;
  const warnings = capabilityWarnings ?? [];

  return (
    <div
      data-testid="ai-tool-drawer"
      data-ai-drawer-root
      className={styles.drawer}
    >
      {/* 标题 */}
      <div className={styles.titleRow}>
        <Icon name={meta.icon} size={13} />
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

      {/* v0.14.9 · 多模型选择器 (按 task 分组, 仅 models > 1 时渲染)。 */}
      {showModelSelector && (
        <div className={styles.field}>
          <span className={styles.label}>模型</span>
          <select
            data-testid="ai-tool-model-select"
            value={activeModelId ?? ""}
            onChange={(e) => onSetActiveModelId?.(e.target.value)}
            className={styles.modelSelect}
          >
            {groupModelsByTask(modelList).map(([task, group]) => (
              <optgroup key={task} label={modelTaskLabel(task)}>
                {group.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name || m.id}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      )}

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

      {/* exemplar 输出形态三选一 (box/mask/both), 对齐 text-prompt; 拖框时按此 mode 派发. */}
      {tool === "exemplar" && exemplarOutputMode && onSetExemplarOutputMode && (
        <div className={styles.field} data-testid="exemplar-output-mode">
          <span className={styles.label}>输出形态</span>
          <SamOutputModeTabs value={exemplarOutputMode} onChange={onSetExemplarOutputMode} />
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

      {/* v0.14.9 · 兼容性警告 (非阻断): active model 输出与项目配置不匹配时提示。 */}
      {warnings.length > 0 && (
        <div className={styles.warnings} data-testid="ai-tool-capability-warnings">
          {warnings.map((w) => (
            <div key={w.key} className={styles.warningItem}>
              <Icon name="warning" size={11} />
              <span>{w.message}</span>
            </div>
          ))}
        </div>
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
