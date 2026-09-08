// v0.18.25 · 交互工具上下文浮块 (前身 AIToolDrawer, 已退役)。
//
// 浮在 ImageStage container 顶部居中, 选中 AI 工具 (point/box/exemplar) 时渲染, 与 MaskToolbar
// 互斥 (mask 非 AI 工具)。主层保留工具提示、候选决策与恢复；高级区折叠引擎、模型、权重、
// 阈值和诊断。配置与本轮推理仍由现有上层 owner 持有，折叠仅改变显示。
// 引擎选择持久化由上层 useAiToolModelPref (服务端 User.preferences.ai.model_by_backend) 承载。

import { useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type {
  MLBackendCapability,
  MLBackendSupportedVariantGroup,
  MLModelCapability,
} from "@/api/ml-backends";
import type { AttributeField } from "@/api/projects";
import { VariantSelector } from "@/components/ml/VariantSelector";
import type { SamPolarity, Tool } from "../state/useWorkbenchState";
import type { TextOutputMode } from "../state/useInteractiveAI";
import type { CapabilityWarning } from "../state/useCapabilityValidation";
import { TOOL_REGISTRY, type ToolId } from "../stage/tools";
// v0.21.27 · U-pvs-1 · 共享的悬浮工具条 chrome（与视频 tracker 传播工具条共用同款外观）。
import {
  TOOLBAR_CHROME_CLASS,
  TOOLBAR_DIVIDER as DIVIDER,
  TOOLBAR_FIELD_LABEL_CLASS as FIELD_LABEL_CLASS,
  TOOLBAR_SELECT_CLASS as SELECT_CLASS,
} from "./workbenchToolbarChrome";

export interface InteractiveToolBarProps {
  tool: Tool;
  /** 解析到的交互后端名称 (来自 /setup.name); undefined → "未绑定". */
  backendName: string | undefined;
  capability: MLBackendCapability | undefined;
  samPolarity: SamPolarity;
  onSetSamPolarity: (p: SamPolarity) => void;
  isLoading: boolean;
  isError: boolean;
  capabilityRecoveryOnly?: boolean;
  capabilityError?: string;
  onRetryCapabilities?: () => void;
  isCapabilityRetrying?: boolean;
  isRunning?: boolean;
  inferenceError?: string | null;
  candidateCount?: number;
  /** Zero-based index supplied by the current inference session. */
  activeCandidateIndex?: number;
  canAcceptCandidates?: boolean;
  candidateActionPending?: boolean;
  onCycleCandidate?: (dir: 1 | -1) => void;
  onAcceptCandidate?: () => void;
  onCancelCandidates?: () => void;
  canRetry?: boolean;
  onRetry?: () => void;
  // exemplar 工具输出形态 (box/mask/both); 会话级状态由 WorkbenchShell 持有.
  exemplarOutputMode?: TextOutputMode;
  onSetExemplarOutputMode?: (mode: TextOutputMode) => void;
  /** 单帧交互候选的持久几何；与 exemplar 的召回结果形态相互独立。 */
  singleFrameOutputGeometry?: "polygon" | "mask";
  onSetSingleFrameOutputGeometry?: (mode: "polygon" | "mask") => void;
  nativeMaskOutputDisabledReason?: string;
  /** 当前已鉴权的已存 Mask 提示摘要；不携带 RLE 正文。 */
  maskPromptSourceLabel?: string;
  // exemplar refine 会话控件 (多正负框 + text 组合 + 阈值重过滤).
  /** 叠加的 text 概念 (PCS text + 几何示例组合); 改动即重跑当前会话。 */
  exemplarText?: string;
  onSetExemplarText?: (text: string) => void;
  /** per-request 阈值; null=用 backend 默认。拖动即重过滤当前会话。 */
  exemplarThreshold?: number | null;
  onSetExemplarThreshold?: (thr: number | null) => void;
  /** backend 默认阈值 (slider 在未覆盖时的展示初值, 取自 /setup.params)。 */
  exemplarThresholdDefault?: number;
  /** 会话进行中 (已落 ≥1 框); 决定阈值/文本提示文案。 */
  exemplarSessionActive?: boolean;
  // 能力声明协议 v2 · 多模型选择. models 长度 <= 1 时**不渲染**选择器 (向后兼容).
  models?: MLModelCapability[];
  activeModelId?: string;
  onSetActiveModelId?: (id: string) => void;
  // active model 与项目配置的兼容性警告 (非阻断). 空数组时不渲染。
  capabilityWarnings?: CapabilityWarning[];
  // v0.20.2 · 「采纳后该属性将丢失」警告的一键补全回调: 把 model 自报字段补进项目所有启用工具单位。
  //   仅 warning.fillable 存在时渲染 CTA; 缺省 = 不渲染补全按钮。
  onFillAttribute?: (field: AttributeField) => void;
  // 交互后端选择器 (能力作用域化): 只列支持当前工具 prompt 的后端, 选中值 = 实际解析后端.
  //   <2 个候选时退化为只读显示 (无 UI 噪音), 行为 = 单后端现状.
  interactiveBackends?: Array<{ id: string; name: string }>;
  selectedInteractiveId?: string | null;
  onSelectInteractive?: (id: string) => void;
  // v0.18.26 · 模型权重(档位)选择: 交互后端 activeModel 的 variant 轴 (series/size 等);
  //   选择写回项目级 default_variants (与批量预标注同源)。无 variant 轴时不渲染入口。
  variantGroups?: MLBackendSupportedVariantGroup[];
  variantCombinations?: string[][];
  /** backend 自报 + 项目偏好合并后的默认 variant 组合 (axis_key → value)。 */
  variantDefaults?: Record<string, string>;
  /** 当前项目已选 variant slice (缺轴由 variantDefaults 兜底)。 */
  variantValue?: Record<string, string>;
  onVariantChange?: (next: Record<string, unknown>) => void;
}

// model.task → 中文分组标题. 受控 task 之外的归「其他」。
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

// 按 task 把 models 分桶, 保持各 task 内的原始顺序; 返回 [task, models[]] 列表。
function groupModelsByTask(models: MLModelCapability[]): Array<[string, MLModelCapability[]]> {
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
  select: null,
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
  "smart-scribble": "在选中的已存 Mask 上绘制正 / 负笔迹",
  "text-prompt": null,
  exemplar: "拖框圈出某个示例，后端找全图相似实例",
  "magic-box": "粗略拖框 → SAM 返回 mask → 取紧凑外接矩形落 bbox",
};

function cn(...xs: Array<string | false | null | undefined>): string {
  return xs.filter(Boolean).join(" ");
}

export function InteractiveToolBar({
  tool,
  backendName,
  capability,
  samPolarity,
  onSetSamPolarity,
  isLoading,
  isError,
  capabilityRecoveryOnly = false,
  capabilityError,
  onRetryCapabilities,
  isCapabilityRetrying = false,
  isRunning = false,
  inferenceError,
  candidateCount = 0,
  activeCandidateIndex = 0,
  canAcceptCandidates = false,
  candidateActionPending = false,
  onCycleCandidate,
  onAcceptCandidate,
  onCancelCandidates,
  canRetry,
  onRetry,
  exemplarOutputMode,
  onSetExemplarOutputMode,
  singleFrameOutputGeometry,
  onSetSingleFrameOutputGeometry,
  nativeMaskOutputDisabledReason,
  maskPromptSourceLabel,
  exemplarText,
  onSetExemplarText,
  exemplarThreshold,
  onSetExemplarThreshold,
  exemplarThresholdDefault,
  exemplarSessionActive,
  models,
  activeModelId,
  onSetActiveModelId,
  capabilityWarnings,
  onFillAttribute,
  interactiveBackends,
  selectedInteractiveId,
  onSelectInteractive,
  variantGroups,
  variantCombinations,
  variantDefaults,
  variantValue,
  onVariantChange,
}: InteractiveToolBarProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const advancedId = useId();
  const meta = TOOL_REGISTRY[tool];
  const hint = TOOL_HINT[tool];
  const hasVariants = !!variantGroups && variantGroups.length > 0 && !!onVariantChange;

  // 模型选择器按当前工具 prompt 过滤: 只列声明支持该交互 prompt 的图像交互 model
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

  // 当前 exemplar 工具对应的交互模型能力 (隐藏后端不支持的控件)。
  // 优先取选中 activeModel, 回退到首个支持 exemplar 的交互模型 (单后端常态)。
  const exemplarModel =
    tool === "exemplar"
      ? (filteredModels.find((m) => m.id === activeModelId) ?? filteredModels[0])
      : undefined;
  const exCaps = exemplarModel?.exemplar_capabilities;
  // 缺省 = 全支持 (向后兼容 sam3 旧 setup 不带本字段时不改行为)。
  const exemplarNegative = exCaps?.negative_box !== false;
  const exemplarTextCombo = exCaps?.text_combination !== false;

  // 后端无负框 (YOLOE) 时强制正极性: 隐藏负极性按钮后, 防止从 smart-point 残留的负极性
  // 让 exemplar 拖框误发 label=False (被后端剔除 → 0 结果)。
  useEffect(() => {
    if (
      !capabilityRecoveryOnly &&
      tool === "exemplar" &&
      !exemplarNegative &&
      samPolarity === "negative"
    ) {
      onSetSamPolarity("positive");
    }
  }, [tool, exemplarNegative, samPolarity, onSetSamPolarity, capabilityRecoveryOnly]);

  // 交互后端选择器: ≥2 个候选 (支持当前工具 prompt 的后端) 时可切, 否则只读显示。
  const backendCands = interactiveBackends ?? [];
  const canSwitchBackend = backendCands.length >= 2 && !!onSelectInteractive;
  const warnings = capabilityWarnings ?? [];
  const totalCandidates = Number.isFinite(candidateCount)
    ? Math.max(0, Math.floor(candidateCount))
    : 0;
  const hasActiveCandidate =
    Number.isInteger(activeCandidateIndex) &&
    activeCandidateIndex >= 0 &&
    activeCandidateIndex < totalCandidates;
  const capabilityFailed = isError || !!capabilityError;
  const capabilityBusy = isLoading || isCapabilityRetrying;
  const inferenceStatus = candidateActionPending
    ? "候选处理中…"
    : isRunning
      ? "本轮推理中…"
      : inferenceError
        ? "本轮推理失败"
        : totalCandidates > 0
          ? "候选已就绪"
          : "等待提示";

  return (
    <div
      data-testid="interactive-toolbar"
      data-workbench-ai-toolbar
      className={cn(
        "absolute left-1/2 top-3 z-local-5 w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2",
        TOOLBAR_CHROME_CLASS,
      )}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div
        data-testid="interactive-toolbar-primary"
        className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5"
      >
        <div
          className="flex shrink-0 items-center gap-1.5"
          title={capabilityRecoveryOnly ? undefined : (hint ?? undefined)}
        >
          <Icon name={capabilityRecoveryOnly ? "info" : meta.icon} size={13} />
          <b className="whitespace-nowrap text-xs">
            {capabilityRecoveryOnly ? "AI 能力" : meta.label}
          </b>
        </div>

        {!capabilityRecoveryOnly && (
          <>
            {(tool === "smart-point" ||
              tool === "smart-scribble" ||
              (tool === "exemplar" && exemplarNegative)) && (
              <div className="flex items-center gap-1.5">
                <span className={FIELD_LABEL_CLASS}>极性</span>
                <button
                  type="button"
                  data-testid="ai-tool-polarity"
                  aria-label={samPolarity === "positive" ? "切换到负向提示" : "切换到正向提示"}
                  onClick={() =>
                    onSetSamPolarity(samPolarity === "positive" ? "negative" : "positive")
                  }
                  className={cn(
                    "flex size-6 cursor-pointer appearance-none items-center justify-center rounded-full border-0 p-0",
                    samPolarity === "positive"
                      ? "bg-status-positive-soft text-status-positive"
                      : "bg-status-danger-soft text-status-danger",
                  )}
                  title={
                    tool === "exemplar"
                      ? samPolarity === "positive"
                        ? "正框 (+, 扩召回) — 按 - 切负框 / 或 Alt 拖框"
                        : "负框 (−, 排误检) — 按 + 切正框 / 或 Alt 拖框"
                      : samPolarity === "positive"
                        ? "正向 (+) — 按 - 切负向"
                        : "负向 (−) — 按 + 切正向"
                  }
                >
                  <Icon name={samPolarity === "positive" ? "plus" : "minus"} size={14} />
                </button>
              </div>
            )}

            {(tool === "smart-point" ||
              tool === "smart-box" ||
              tool === "smart-scribble" ||
              tool === "exemplar") &&
              singleFrameOutputGeometry &&
              onSetSingleFrameOutputGeometry && (
                <div
                  className="flex min-w-0 items-center gap-1.5"
                  data-testid="single-frame-output-geometry"
                >
                  <span className={FIELD_LABEL_CLASS}>提交</span>
                  <select
                    data-testid="single-frame-output-geometry-select"
                    aria-label="单帧提交几何"
                    value={singleFrameOutputGeometry}
                    onChange={(event) =>
                      onSetSingleFrameOutputGeometry(event.target.value as "polygon" | "mask")
                    }
                    className={cn(SELECT_CLASS, "min-w-0 max-w-full cursor-pointer")}
                    title={nativeMaskOutputDisabledReason ?? "单帧候选持久化几何"}
                  >
                    <option value="polygon">多边形</option>
                    <option value="mask" disabled={nativeMaskOutputDisabledReason != null}>
                      原生 Mask
                    </option>
                  </select>
                </div>
              )}

            {maskPromptSourceLabel &&
              (tool === "smart-point" || tool === "smart-box" || tool === "smart-scribble") && (
                <span
                  data-testid="mask-prompt-source"
                  className="max-w-full break-words rounded-full bg-status-positive-soft px-2 py-1 text-2xs font-medium text-status-positive"
                  title="本轮以已存原生 Mask 为种子，接纳后原位更新"
                >
                  {maskPromptSourceLabel}
                </span>
              )}

            {tool === "exemplar" && exemplarOutputMode && onSetExemplarOutputMode && (
              <div className="flex min-w-0 items-center gap-1.5" data-testid="exemplar-output-mode">
                <span className={FIELD_LABEL_CLASS}>形态</span>
                <select
                  data-testid="exemplar-output-mode-select"
                  aria-label="示例召回形态"
                  value={exemplarOutputMode}
                  onChange={(event) =>
                    onSetExemplarOutputMode(event.target.value as TextOutputMode)
                  }
                  className={cn(SELECT_CLASS, "min-w-0 max-w-full cursor-pointer")}
                  title="输出形态"
                >
                  <option value="box">□ 框</option>
                  <option value="mask">○ 掩膜</option>
                  <option value="both">⊕ 全部</option>
                </select>
              </div>
            )}

            {tool === "exemplar" && onSetExemplarText && exemplarTextCombo && (
              <div className="flex min-w-0 items-center gap-1.5" data-testid="exemplar-text">
                <span className={FIELD_LABEL_CLASS}>文本</span>
                <input
                  type="text"
                  aria-label="示例叠加文本"
                  value={exemplarText ?? ""}
                  onChange={(event) => onSetExemplarText(event.target.value)}
                  placeholder="如 car"
                  className="w-24 min-w-0 rounded-sm border border-border bg-muted px-1.5 py-1 text-xs text-foreground placeholder:text-muted-foreground"
                  title="叠加文本概念 (与示例框组合)"
                />
              </div>
            )}

            {DIVIDER}
            <div className="flex flex-wrap items-center gap-1">
              <span
                data-testid="interactive-candidate-count"
                className="whitespace-nowrap text-2xs tabular-nums text-muted-foreground"
                aria-live="polite"
              >
                候选 {hasActiveCandidate ? activeCandidateIndex + 1 : 0} / {totalCandidates}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                data-testid="interactive-candidate-previous"
                aria-label="上一个候选"
                title="上一个候选"
                disabled={
                  !hasActiveCandidate ||
                  totalCandidates < 2 ||
                  !onCycleCandidate ||
                  isRunning ||
                  candidateActionPending
                }
                onClick={() => onCycleCandidate?.(-1)}
              >
                <Icon name="chevron-left" size={12} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                data-testid="interactive-candidate-next"
                aria-label="下一个候选"
                title="下一个候选"
                disabled={
                  !hasActiveCandidate ||
                  totalCandidates < 2 ||
                  !onCycleCandidate ||
                  isRunning ||
                  candidateActionPending
                }
                onClick={() => onCycleCandidate?.(1)}
              >
                <Icon name="chevron-right" size={12} />
              </Button>
              <Button
                type="button"
                variant="primary"
                size="xs"
                data-testid="interactive-candidate-accept"
                disabled={
                  !hasActiveCandidate ||
                  !canAcceptCandidates ||
                  !onAcceptCandidate ||
                  isRunning ||
                  candidateActionPending
                }
                onClick={onAcceptCandidate}
              >
                <Icon name={candidateActionPending ? "loader2" : "check"} size={12} />
                接受
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                data-testid="interactive-candidate-cancel"
                disabled={!onCancelCandidates || candidateActionPending}
                onClick={onCancelCandidates}
              >
                <Icon name="x" size={12} />
                取消本轮
              </Button>
            </div>

            <span
              data-testid="interactive-inference-status"
              role="status"
              className={cn(
                "flex items-center gap-1 whitespace-nowrap text-2xs",
                inferenceError ? "text-status-danger" : "text-muted-foreground",
              )}
            >
              {(isRunning || candidateActionPending) && <Icon name="loader2" size={11} />}
              {inferenceStatus}
            </span>
            {canRetry && onRetry && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={isRunning || candidateActionPending}
                onClick={onRetry}
                data-testid="interactive-prompt-retry"
              >
                <Icon name="rotate-ccw" size={11} />
                重试本轮
              </Button>
            )}
          </>
        )}

        <span
          data-testid="interactive-capability-status"
          role="status"
          className={cn(
            "flex items-center gap-1 whitespace-nowrap text-2xs",
            capabilityFailed && !capabilityBusy ? "text-status-danger" : "text-muted-foreground",
          )}
        >
          {capabilityBusy && <Icon name="loader2" size={11} />}
          {capabilityBusy
            ? "正在加载能力…"
            : capabilityFailed
              ? "能力协商失败"
              : capability
                ? "能力就绪"
                : "未获取能力"}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          data-testid="interactive-toolbar-advanced-toggle"
          aria-expanded={advancedOpen}
          aria-controls={advancedId}
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          <Icon name={advancedOpen ? "chevUp" : "chevDown"} size={12} />
          高级配置{warnings.length > 0 ? ` · ${warnings.length}` : ""}
        </Button>
      </div>

      {capabilityFailed && (
        <div
          data-testid="interactive-capability-error"
          className="flex min-w-0 flex-wrap items-center gap-1.5 rounded-sm bg-status-danger-soft px-1.5 py-1 text-2xs text-status-danger"
        >
          <span role="alert" className="min-w-0 flex-1 break-words">
            能力协商：{capabilityError ?? "无法获取后端能力"}
          </span>
          {onRetryCapabilities && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              data-testid="interactive-capability-retry"
              disabled={capabilityBusy}
              onClick={onRetryCapabilities}
            >
              <Icon name={capabilityBusy ? "loader2" : "rotate-ccw"} size={11} />
              {capabilityBusy ? "重试中…" : "重试能力协商"}
            </Button>
          )}
        </div>
      )}

      {!capabilityRecoveryOnly && inferenceError && (
        <div
          data-testid="interactive-inference-error"
          role="alert"
          className="min-w-0 break-words rounded-sm bg-status-danger-soft px-1.5 py-1 text-2xs text-status-danger"
        >
          本轮推理：{inferenceError}
        </div>
      )}

      {/* Keep configuration controls mounted so folding never resets their state or requests. */}
      <section
        id={advancedId}
        data-testid="interactive-toolbar-advanced"
        aria-label="AI 高级设置"
        hidden={!advancedOpen}
        className="border-t border-border pt-1.5"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
            <span className={FIELD_LABEL_CLASS}>引擎</span>
            <select
              data-testid="ai-tool-backend-select"
              aria-label="交互后端"
              value={canSwitchBackend ? (selectedInteractiveId ?? "") : (backendName ?? "")}
              disabled={!canSwitchBackend}
              onChange={(event) => onSelectInteractive?.(event.target.value)}
              className={cn(SELECT_CLASS, "min-w-0 max-w-full opacity-[0.85]")}
              title="交互后端"
            >
              {canSwitchBackend ? (
                backendCands.map((backend) => (
                  <option key={backend.id} value={backend.id}>
                    {backend.name}
                  </option>
                ))
              ) : (
                <option value={backendName ?? ""}>{backendName ?? "未绑定 ML 后端"}</option>
              )}
            </select>
            {showModelSelector && (
              <select
                data-testid="ai-tool-model-select"
                aria-label="模型"
                value={activeModelId ?? ""}
                onChange={(event) => onSetActiveModelId?.(event.target.value)}
                className={cn(SELECT_CLASS, "min-w-0 max-w-full cursor-pointer")}
                title="模型"
              >
                {groupModelsByTask(filteredModels).map(([task, group]) => (
                  <optgroup key={task} label={modelTaskLabel(task)}>
                    {group.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.display_name || model.id}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            )}
            {hasVariants && (
              <VariantSelector
                compact
                supportedVariants={variantGroups}
                variantCombinations={variantCombinations}
                defaults={variantDefaults}
                value={variantValue ?? {}}
                onChange={(next) => onVariantChange?.(next)}
              />
            )}
          </div>

          {!capabilityRecoveryOnly && tool === "exemplar" && onSetExemplarThreshold && (
            <div className="flex items-center gap-1.5" data-testid="exemplar-threshold">
              <span className={FIELD_LABEL_CLASS}>阈值</span>
              <input
                type="range"
                aria-label="示例召回阈值"
                min={0}
                max={1}
                step={0.05}
                value={exemplarThreshold ?? exemplarThresholdDefault ?? 0.5}
                onChange={(event) => onSetExemplarThreshold(Number(event.target.value))}
                className="w-20 cursor-pointer accent-brand"
                title={
                  exemplarSessionActive
                    ? "拖动实时增减结果 (调高更准 / 调低更全)"
                    : "拖框后开始 refine; 加正框扩召回 / Alt 或负极性加负框去误检"
                }
              />
              <span className="min-w-[2.5rem] text-2xs tabular-nums text-muted-foreground">
                {(exemplarThreshold ?? exemplarThresholdDefault ?? 0.5).toFixed(2)}
                {exemplarThreshold == null && "*"}
              </span>
              {exemplarThreshold != null && (
                <button
                  type="button"
                  data-testid="exemplar-threshold-reset"
                  aria-label="重置为后端默认阈值"
                  onClick={() => onSetExemplarThreshold(null)}
                  className="flex size-5 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground"
                  title="重置为后端默认阈值 (*)"
                >
                  <Icon name="rotate-ccw" size={11} />
                </button>
              )}
            </div>
          )}
        </div>

        <p
          className="my-1 text-2xs text-muted-foreground"
          data-testid="interactive-capability-diagnostics"
        >
          {capability
            ? `能力：${capability.name}${capability.version ? ` · ${capability.version}` : ""}${capability.protocol_version ? ` · 协议 ${capability.protocol_version}` : ""}`
            : "尚无后端能力信息"}
        </p>

        {warnings.length > 0 && (
          <div
            className="flex flex-wrap items-center gap-2"
            data-testid="ai-tool-capability-warnings"
          >
            {warnings.map((warning) => (
              <div
                key={warning.key}
                className="flex min-w-0 flex-wrap items-start gap-1 rounded-sm bg-status-caution-soft px-1.5 py-0.5 text-2xs leading-[1.4] text-status-caution"
              >
                <Icon name="warning" size={11} />
                <span className="min-w-0 break-words">{warning.message}</span>
                {warning.fillable && onFillAttribute && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => onFillAttribute(warning.fillable!)}
                    title="把该属性字段补进项目所有启用工具单位"
                  >
                    一键补全
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
