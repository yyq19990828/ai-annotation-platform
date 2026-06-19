// v0.10.2 · Prompt-first ToolDock 的右侧抽屉.
// 任一 AI 工具激活时浮出, 含: 工具标题 + 交互后端选择器 + 工具特定控件 (smart-point 极性 /
// 提示文案) + Schema-form 参数面板 + 状态指示. 预测结果列表仍留右栏 AIInspectorPanel.
// v0.14.18 · text-prompt 工具归批量线 (从工具栏摘除), 故 SamTextPanel 输入段不再在此渲染;
//   「后端」槽位改为交互后端选择器 (≥2 候选时可切, 能力作用域化); 模型选择器按当前工具 prompt 过滤.

import { Icon } from "@/components/ui/Icon";
import type { MLBackendCapability, MLModelCapability } from "@/api/ml-backends";
import type { SamPolarity, Tool } from "../state/useWorkbenchState";
import type { TextOutputMode } from "../state/useInteractiveAI";
import type { CapabilityWarning } from "../state/useCapabilityValidation";
import { TOOL_REGISTRY, type ToolId } from "../stage/tools";
import { SamOutputModeTabs } from "./SamOutputModeTabs";

const FIELD_LABEL_CLASS = "text-[10.5px] text-muted-foreground";
const SELECT_CLASS =
  "appearance-none rounded-sm border border-border bg-muted px-1.5 py-[3px] text-[11.5px] text-foreground";

export interface AIToolDrawerProps {
  tool: Tool;
  /** v0.10.2 · 解析到的交互后端名称 (来自 /setup.name); undefined → "未绑定". */
  backendName: string | undefined;
  capability: MLBackendCapability | undefined;
  samPolarity: SamPolarity;
  onSetSamPolarity: (p: SamPolarity) => void;
  isLoading: boolean;
  isError: boolean;
  // exemplar 工具输出形态 (box/mask/both); 会话级状态由 WorkbenchShell 持有.
  exemplarOutputMode?: TextOutputMode;
  onSetExemplarOutputMode?: (mode: TextOutputMode) => void;
  // v0.14.9 · 能力声明协议 v2 · 多模型选择. models 长度 <= 1 时**不渲染**选择器 (向后兼容).
  models?: MLModelCapability[];
  activeModelId?: string;
  onSetActiveModelId?: (id: string) => void;
  // v0.14.9 · active model 与项目配置的兼容性警告 (非阻断). 空数组时不渲染。
  capabilityWarnings?: CapabilityWarning[];
  // v0.14.18 · 交互后端选择器 (能力作用域化): 只列支持当前工具 prompt 的后端, 选中值 = 实际解析后端.
  //   <2 个候选时退化为只读显示 (无 UI 噪音), 行为 = 单后端现状.
  interactiveBackends?: Array<{ id: string; name: string }>;
  selectedInteractiveId?: string | null;
  onSelectInteractive?: (id: string) => void;
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
  // v0.14.18 · text-prompt 已归批量线, 工具栏不再有此工具 (entry 保留仅为类型完整).
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
  exemplarOutputMode,
  onSetExemplarOutputMode,
  models,
  activeModelId,
  onSetActiveModelId,
  capabilityWarnings,
  interactiveBackends,
  selectedInteractiveId,
  onSelectInteractive,
}: AIToolDrawerProps) {
  const meta = TOOL_REGISTRY[tool];
  const hint = TOOL_HINT[tool];

  // v0.14.18 · 模型选择器按当前工具 prompt 过滤: 只列声明支持该交互 prompt 的图像交互 model
  // (point → 仅 interactive_seg; tracker 属视频, 排除)。过滤后通常剩 1 个 → 选择器自动隐藏。
  const toolPrompt = TOOL_REGISTRY[tool]?.requiredPrompt;
  const modelList = models ?? [];
  const filteredModels =
    toolPrompt && toolPrompt !== "text"
      ? modelList.filter(
          (m) =>
            m.is_interactive === true &&
            m.task !== "tracker" &&
            (m.supported_prompts ?? []).includes(toolPrompt),
        )
      : modelList;
  const showModelSelector = filteredModels.length > 1 && !!onSetActiveModelId;
  const warnings = capabilityWarnings ?? [];

  // v0.14.18 · 交互后端选择器: ≥2 个候选 (支持当前工具 prompt 的后端) 时可切, 否则只读显示。
  const backendCands = interactiveBackends ?? [];
  const canSwitchBackend = backendCands.length >= 2 && !!onSelectInteractive;

  return (
    <div
      data-testid="ai-tool-drawer"
      data-ai-drawer-root
      className="flex w-60 flex-col gap-2 rounded-md border border-border bg-card p-2.5 px-3 shadow-md"
    >
      {/* 标题 */}
      <div className="flex items-center gap-1.5">
        <Icon name={meta.icon} size={13} />
        <b className="text-xs">{meta.label}</b>
      </div>

      {/* v0.14.18 · 交互后端选择器: ≥2 候选时可切 (只列支持当前工具的后端), 否则只读显示解析后端。 */}
      <div className="flex flex-col gap-[3px]">
        <span className={FIELD_LABEL_CLASS}>后端</span>
        <select
          data-testid="ai-tool-backend-select"
          value={canSwitchBackend ? (selectedInteractiveId ?? "") : (backendName ?? "")}
          disabled={!canSwitchBackend}
          onChange={(e) => onSelectInteractive?.(e.target.value)}
          className={`${SELECT_CLASS} opacity-[0.85]`}
        >
          {canSwitchBackend ? (
            backendCands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))
          ) : (
            <option value={backendName ?? ""}>
              {backendName ?? "未绑定 ML 后端"}
            </option>
          )}
        </select>
      </div>

      {/* v0.14.9 · 多模型选择器 (按 task 分组, 按当前工具 prompt 过滤后 > 1 时渲染)。 */}
      {showModelSelector && (
        <div className="flex flex-col gap-[3px]">
          <span className={FIELD_LABEL_CLASS}>模型</span>
          <select
            data-testid="ai-tool-model-select"
            value={activeModelId ?? ""}
            onChange={(e) => onSetActiveModelId?.(e.target.value)}
            className={`${SELECT_CLASS} cursor-pointer`}
          >
            {groupModelsByTask(filteredModels).map(([task, group]) => (
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
        <div className="flex items-center gap-2">
          <span className={FIELD_LABEL_CLASS}>极性</span>
          <button
            type="button"
            data-testid="ai-tool-polarity"
            onClick={() => onSetSamPolarity(samPolarity === "positive" ? "negative" : "positive")}
            className={cn(
              "flex size-6 cursor-pointer appearance-none items-center justify-center rounded-full border-0 p-0 text-[13px] font-bold leading-none text-white",
              samPolarity === "positive" ? "bg-emerald-500" : "bg-amber-500",
            )}
            title={samPolarity === "positive" ? "正向 (+) — 按 - 切负向" : "负向 (−) — 按 + 切正向"}
          >
            {samPolarity === "positive" ? "+" : "−"}
          </button>
        </div>
      )}

      {hint && (
        <div className="rounded-sm bg-muted px-1.5 py-1 text-[10.5px] leading-[1.4] text-muted-foreground">
          {hint}
        </div>
      )}

      {/* exemplar 输出形态三选一 (box/mask/both), 对齐 text-prompt; 拖框时按此 mode 派发. */}
      {tool === "exemplar" && exemplarOutputMode && onSetExemplarOutputMode && (
        <div className="flex flex-col gap-[3px]" data-testid="exemplar-output-mode">
          <span className={FIELD_LABEL_CLASS}>输出形态</span>
          <SamOutputModeTabs value={exemplarOutputMode} onChange={onSetExemplarOutputMode} />
        </div>
      )}

      {/* v0.14.9 · 兼容性警告 (非阻断): active model 输出与项目配置不匹配时提示。 */}
      {warnings.length > 0 && (
        <div className="flex flex-col gap-1" data-testid="ai-tool-capability-warnings">
          {warnings.map((w) => (
            <div
              key={w.key}
              className="flex items-start gap-1 rounded-sm bg-amber-500/10 px-1.5 py-1 text-[10.5px] leading-[1.4] text-amber-600 dark:text-amber-400"
            >
              <Icon name="warning" size={11} />
              <span>{w.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* 状态指示 */}
      <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
        <span
          aria-hidden
          className={cn(
            "size-1.5 rounded-full",
            isError
              ? "bg-rose-500"
              : isLoading
                ? "bg-amber-500"
                : capability
                  ? "bg-emerald-500"
                  : "bg-muted-foreground",
          )}
        />
        <span>
          {isError ? "后端协商失败" : isLoading ? "加载中" : capability ? `${capability.name} v${capability.version ?? ""}` : "无能力数据"}
        </span>
      </div>
    </div>
  );
}
