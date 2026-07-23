// v0.18.25 · 交互工具上下文浮块 (前身 AIToolDrawer, 已退役)。
//
// 浮在 ImageStage container 顶部居中, 选中 AI 工具 (point/box/exemplar) 时渲染, 与 MaskToolbar
// 互斥 (mask 非 AI 工具)。内容: 引擎 (后端+模型) 选择 + 工具特定控件 (极性 / 输出形态 / 叠加文本 /
// 阈值) + 兼容性警告 + 状态指示。横排布局 (对齐 MaskToolbar 浮块风格), 取代旧的贴 ToolDock 右侧竖排抽屉。
// 引擎选择持久化由上层 useAiToolModelPref (服务端 User.preferences.ai.model_by_backend) 承载。

import { useEffect } from "react";

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
    if (tool === "exemplar" && !exemplarNegative && samPolarity === "negative") {
      onSetSamPolarity("positive");
    }
  }, [tool, exemplarNegative, samPolarity, onSetSamPolarity]);

  // 交互后端选择器: ≥2 个候选 (支持当前工具 prompt 的后端) 时可切, 否则只读显示。
  const backendCands = interactiveBackends ?? [];
  const canSwitchBackend = backendCands.length >= 2 && !!onSelectInteractive;
  const warnings = capabilityWarnings ?? [];

  return (
    <div
      data-testid="interactive-toolbar"
      className={cn(
        "absolute left-1/2 top-3 z-local-5 max-w-[calc(100%-1.5rem)] -translate-x-1/2",
        TOOLBAR_CHROME_CLASS,
      )}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* 主行: 标题 + 引擎 + 工具控件 + 状态 (横排) */}
      <div className="flex items-center gap-2.5">
        {/* 标题 */}
        <div className="flex shrink-0 items-center gap-1.5" title={hint ?? undefined}>
          <Icon name={meta.icon} size={13} />
          <b className="whitespace-nowrap text-xs">{meta.label}</b>
        </div>

        {canRetry && onRetry && (
          <>
            {DIVIDER}
            <Button
              variant="ghost"
              size="xs"
              onClick={onRetry}
              data-testid="interactive-prompt-retry"
            >
              <Icon name="rotate-ccw" size={11} />
              重试本轮
            </Button>
          </>
        )}

        {DIVIDER}

        {/* 引擎: 后端 (≥2 候选可切, 否则只读) + 模型 (过滤后 >1 时) */}
        <div className="flex items-center gap-1.5">
          <span className={FIELD_LABEL_CLASS}>引擎</span>
          <select
            data-testid="ai-tool-backend-select"
            value={canSwitchBackend ? (selectedInteractiveId ?? "") : (backendName ?? "")}
            disabled={!canSwitchBackend}
            onChange={(e) => onSelectInteractive?.(e.target.value)}
            className={`${SELECT_CLASS} opacity-[0.85]`}
            title="交互后端"
          >
            {canSwitchBackend ? (
              backendCands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))
            ) : (
              <option value={backendName ?? ""}>{backendName ?? "未绑定 ML 后端"}</option>
            )}
          </select>
          {showModelSelector && (
            <select
              data-testid="ai-tool-model-select"
              value={activeModelId ?? ""}
              onChange={(e) => onSetActiveModelId?.(e.target.value)}
              className={`${SELECT_CLASS} cursor-pointer`}
              title="模型"
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
          )}
          {/* v0.18.26 · 模型权重(档位): 内联紧凑下拉 (series/size 多轴, 复用 VariantSelector 联动逻辑)。 */}
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

        {/* 极性切换 (smart-point 点正负 / exemplar 框正负, 与 Alt 修饰键合并)。
            exemplar 仅在后端支持负框时显示 (YOLOE negative_box=false → 隐藏, 恒正框)。 */}
        {(tool === "smart-point" ||
          tool === "smart-scribble" ||
          (tool === "exemplar" && exemplarNegative)) && (
          <>
            {DIVIDER}
            <div className="flex items-center gap-1.5">
              <span className={FIELD_LABEL_CLASS}>极性</span>
              <button
                type="button"
                data-testid="ai-tool-polarity"
                onClick={() =>
                  onSetSamPolarity(samPolarity === "positive" ? "negative" : "positive")
                }
                className={cn(
                  "flex size-6 cursor-pointer appearance-none items-center justify-center rounded-full border-0 p-0 text-white",
                  samPolarity === "positive" ? "bg-emerald-500" : "bg-rose-500",
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
          </>
        )}

        {/* 单帧最终几何与 exemplar 的 box/mask/both 召回形态不是同一维度。 */}
        {(tool === "smart-point" ||
          tool === "smart-box" ||
          tool === "smart-scribble" ||
          tool === "exemplar") &&
          singleFrameOutputGeometry &&
          onSetSingleFrameOutputGeometry && (
            <>
              {DIVIDER}
              <div className="flex items-center gap-1.5" data-testid="single-frame-output-geometry">
                <span className={FIELD_LABEL_CLASS}>提交</span>
                <select
                  data-testid="single-frame-output-geometry-select"
                  value={singleFrameOutputGeometry}
                  onChange={(event) =>
                    onSetSingleFrameOutputGeometry(event.target.value as "polygon" | "mask")
                  }
                  className={`${SELECT_CLASS} cursor-pointer`}
                  title={nativeMaskOutputDisabledReason ?? "单帧候选持久化几何"}
                >
                  <option value="polygon">多边形</option>
                  <option value="mask" disabled={nativeMaskOutputDisabledReason != null}>
                    原生 Mask
                  </option>
                </select>
              </div>
            </>
          )}

        {maskPromptSourceLabel &&
          (tool === "smart-point" || tool === "smart-box" || tool === "smart-scribble") && (
            <>
              {DIVIDER}
              <span
                data-testid="mask-prompt-source"
                className="whitespace-nowrap rounded-full bg-status-positive-soft px-2 py-1 text-2xs font-medium text-emerald-700 dark:text-emerald-400"
                title="本轮以已存原生 Mask 为种子，接纳后原位更新"
              >
                {maskPromptSourceLabel}
              </span>
            </>
          )}

        {/* exemplar 输出形态三选一 (box/mask/both) — 下拉, 与引擎排下拉风格统一 */}
        {tool === "exemplar" && exemplarOutputMode && onSetExemplarOutputMode && (
          <>
            {DIVIDER}
            <div className="flex items-center gap-1.5" data-testid="exemplar-output-mode">
              <span className={FIELD_LABEL_CLASS}>形态</span>
              <select
                data-testid="exemplar-output-mode-select"
                value={exemplarOutputMode}
                onChange={(e) => onSetExemplarOutputMode(e.target.value as TextOutputMode)}
                className={`${SELECT_CLASS} cursor-pointer`}
                title="输出形态"
              >
                <option value="box">□ 框</option>
                <option value="mask">○ 掩膜</option>
                <option value="both">⊕ 全部</option>
              </select>
            </div>
          </>
        )}

        {/* exemplar 叠加 text 概念 (后端支持时) */}
        {tool === "exemplar" && onSetExemplarText && exemplarTextCombo && (
          <>
            {DIVIDER}
            <div className="flex items-center gap-1.5" data-testid="exemplar-text">
              <span className={FIELD_LABEL_CLASS}>文本</span>
              <input
                type="text"
                value={exemplarText ?? ""}
                onChange={(e) => onSetExemplarText(e.target.value)}
                placeholder="如 car"
                className="w-24 rounded-sm border border-border bg-muted px-1.5 py-1 text-xs text-foreground placeholder:text-muted-foreground"
                title="叠加文本概念 (与示例框组合)"
              />
            </div>
          </>
        )}

        {/* exemplar per-request 阈值 */}
        {tool === "exemplar" && onSetExemplarThreshold && (
          <>
            {DIVIDER}
            <div className="flex items-center gap-1.5" data-testid="exemplar-threshold">
              <span className={FIELD_LABEL_CLASS}>阈值</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={exemplarThreshold ?? exemplarThresholdDefault ?? 0.5}
                onChange={(e) => onSetExemplarThreshold(Number(e.target.value))}
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
              {/* 拖动后阈值变成固定值, 此按钮把它重置回 null (跟随后端默认, 显示 *)。见 issue 0007。 */}
              {exemplarThreshold != null && (
                <button
                  type="button"
                  data-testid="exemplar-threshold-reset"
                  onClick={() => onSetExemplarThreshold(null)}
                  className="flex size-5 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground"
                  title="重置为后端默认阈值 (*)"
                >
                  <Icon name="rotate-ccw" size={11} />
                </button>
              )}
            </div>
          </>
        )}

        {DIVIDER}

        {/* 状态指示 */}
        <div
          className="flex items-center gap-1 text-2xs text-muted-foreground"
          title={capability ? `${capability.name} v${capability.version ?? ""}` : undefined}
        >
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
            {isError ? "协商失败" : isLoading ? "加载中" : capability ? capability.name : "无能力"}
          </span>
        </div>
      </div>

      {/* 兼容性警告 (非阻断): active model 输出与项目配置不匹配时提示 (折到主行下方一行)。 */}
      {warnings.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-2"
          data-testid="ai-tool-capability-warnings"
        >
          {warnings.map((w) => (
            <div
              key={w.key}
              className="flex items-start gap-1 rounded-sm bg-status-caution-soft px-1.5 py-0.5 text-2xs leading-[1.4] text-status-caution"
            >
              <Icon name="warning" size={11} />
              <span>{w.message}</span>
              {w.fillable && onFillAttribute && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => onFillAttribute(w.fillable!)}
                  title="把该属性字段补进项目所有启用工具单位"
                >
                  一键补全
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
