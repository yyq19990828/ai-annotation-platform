import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import type {
  VideoTrackerDirection,
  VideoTrackerPropagatePayload,
} from "@/api/videoTracker";
import { readDialogMemory, writeDialogMemory } from "../state/videoDialogMemory";
// v0.21.27 · U-pvs-1 · 与 SAM 交互工具条 (InteractiveToolBar) 共用同款悬浮工具条 chrome。
import {
  TOOLBAR_CHROME_CLASS,
  TOOLBAR_DIVIDER,
  TOOLBAR_FIELD_LABEL_CLASS,
  TOOLBAR_SELECT_CLASS,
} from "../shell/workbenchToolbarChrome";

const SPAN_PRESETS = ["10", "30", "60"] as const;
const RANGE_PRESETS = [
  ...SPAN_PRESETS,
  "next-keyframe",
  "end",
] as const;

type RangePresetValue = (typeof RANGE_PRESETS)[number];
type TrackerDialogMemory = {
  rangePreset: RangePresetValue;
  direction: VideoTrackerDirection;
  modelKey: string;
  samVariant: string;
};

// 采样开启 (step>1) 时数字预设以网格格子为单位, 标签显示如「10 格 (≈100 帧)」;
// 关闭时维持「N 帧」。next-keyframe / end 与单位无关, 标签固定。
function presetLabel(value: RangePresetValue, step: number): string {
  if (value === "next-keyframe") return "到下一关键帧";
  if (value === "end") return "到结尾";
  const n = Number(value);
  return step > 1 ? `${n} 格 (≈${n * step} 帧)` : `${n} 帧`;
}

// v0.21.27 · U-pvs-3 · U3: label 用人类可读名 + 能力一句话 (原为裸 key, 对标注员无意义)。
// value 保持不变 (提交/记忆/测试均按 value)。
export const TRACKER_MODEL_OPTIONS: Array<{ value: string; label: string; note?: string }> = [
  { value: "mock_bbox", label: "mock · 测试框", note: "测试用 (不依赖 ML backend)" },
  { value: "sam2_video", label: "SAM2 · 框追踪", note: "种子框跨帧追踪 · 需项目绑定 ML backend" },
  { value: "sam3_video", label: "SAM3 · 文本检测追踪", note: "按文本每帧检测 · 需项目绑定 ML backend" },
  // v0.21.26 · 阶段 B-pvs · SAM3 交互追踪 (点/框 seed + memory 跨帧, 非文本驱动)。与
  // sam2_video 同为种子传播 (不显 text 框); 需绑定声明该 tracker 的 sam3 backend。
  {
    value: "sam3_video_interactive",
    label: "SAM3 · 点框交互追踪",
    note: "点/框种子 + memory 跨帧 · 需项目绑定 sam3 backend",
  },
];

// v0.10.36: SAM 模型尺寸 (tracker 不用 DINO, 只选 SAM 尺寸)。空 = 默认/tiny。
const SAM_VARIANTS: Array<{ value: string; label: string }> = [
  { value: "", label: "默认 (tiny)" },
  { value: "tiny", label: "tiny" },
  { value: "small", label: "small" },
  { value: "base_plus", label: "base_plus" },
  { value: "large", label: "large" },
];

// v0.21.27 · U-pvs-3 · U1: 方向标签消歧。forward/backward 用「更晚/更早帧」+ 箭头,
// 避免「向后追踪」被误读成倒放; title 补全语义。
const DIRECTION_META: Record<
  VideoTrackerDirection,
  { label: string; title: string }
> = {
  forward: { label: "更晚帧 →", title: "向后追踪: 传播到更晚 (时间轴更右) 的帧" },
  backward: { label: "← 更早帧", title: "向前追踪: 传播到更早 (时间轴更左) 的帧" },
  bidirectional: { label: "⇆ 双向", title: "双向: 同时向更早与更晚帧传播" },
};

// v0.21.27 · U-pvs-3 · U6: 分窗窗口数粗估。窗口尺寸镜像后端默认 (sam3 系 16 / 其余 300,
// 见 VIDEO_TRACKER_SAM3_WINDOW_SIZE_FRAMES / VIDEO_TRACKER_WINDOW_SIZE_FRAMES); 后端 env
// 可覆盖, 故仅作「会分多窗」的粗略提示, 不做精确耗时。
function estimateWindowCount(frameSpan: number, modelKey: string): number {
  const windowSize = modelKey.startsWith("sam3") ? 16 : 300;
  const frames = Math.max(1, frameSpan + 1);
  return Math.max(1, Math.ceil(frames / windowSize));
}

const DEFAULT_TRACKER_MEMORY: TrackerDialogMemory = {
  rangePreset: "30",
  direction: "forward",
  modelKey: "mock_bbox",
  samVariant: "",
};

export function resolveTrackerDefaultModel({
  projectDefaultModel,
  rememberedModel,
  preferNonMockModel,
  options = TRACKER_MODEL_OPTIONS,
}: {
  projectDefaultModel?: string | null;
  rememberedModel?: string | null;
  preferNonMockModel: boolean;
  options?: Array<{ value: string }>;
}): string {
  const values = new Set(options.map((model) => model.value));
  if (projectDefaultModel && values.has(projectDefaultModel)) return projectDefaultModel;
  if (rememberedModel && values.has(rememberedModel)) return rememberedModel;
  if (preferNonMockModel) {
    const realModel = options.find((model) => model.value !== "mock_bbox");
    if (realModel) return realModel.value;
  }
  return values.has("mock_bbox") ? "mock_bbox" : options[0]?.value ?? "mock_bbox";
}

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function hasOption<T extends string>(
  options: readonly T[],
  value: unknown,
): value is T {
  return typeof value === "string" && options.includes(value as T);
}

function validateTrackerMemory(value: unknown): TrackerDialogMemory | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<TrackerDialogMemory>;
  const modelValues = TRACKER_MODEL_OPTIONS.map((m) => m.value);
  const variantValues = SAM_VARIANTS.map((v) => v.value);
  return {
    rangePreset: hasOption(RANGE_PRESETS, raw.rangePreset)
      ? raw.rangePreset
      : DEFAULT_TRACKER_MEMORY.rangePreset,
    direction:
      raw.direction === "forward" ||
      raw.direction === "backward" ||
      raw.direction === "bidirectional"
        ? raw.direction
        : DEFAULT_TRACKER_MEMORY.direction,
    modelKey:
      typeof raw.modelKey === "string" && modelValues.includes(raw.modelKey)
        ? raw.modelKey
        : DEFAULT_TRACKER_MEMORY.modelKey,
    samVariant:
      typeof raw.samVariant === "string" && variantValues.includes(raw.samVariant)
        ? raw.samVariant
        : DEFAULT_TRACKER_MEMORY.samVariant,
  };
}

interface VideoTrackerPropagateDialogProps {
  open: boolean;
  frameIndex: number;
  maxFrame: number;
  nextKeyframeAfter: number | null;
  /** 向前(backward)传播的「到上一关键帧」目标; 缺省 null 时回退到固定跨度。 */
  prevKeyframeBefore?: number | null;
  userId?: string | null;
  /** 采样网格步长 (源帧). >1 时数字预设以网格格子为单位; 缺省 1 = 现状 (按源帧). */
  samplingStep?: number;
  projectDefaultModel?: string | null;
  preferNonMockModel?: boolean;
  /** v0.21.19 · backend /setup 声明的可用 tracker; 用于灰置未声明的 text-driven tracker (sam3_video)。 */
  supportedTrackers?: string[];
  /** v0.21.19 · text-driven tracker 子集; 选中其中之一时显 text 框。缺省时 sam3_video 静态视为 text-driven。 */
  textDrivenTrackers?: string[];
  /** polyline 轨迹传播暂不支持 (后端只识别 polygon/bbox track); 为真时灰置传播动作。 */
  isPolylineTrack?: boolean;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (payload: VideoTrackerPropagatePayload) => Promise<void>;
  /** v0.21.14 WS3 · 上报当前影响范围, 供时间轴高亮「将影响哪段帧」; 关闭时上报 null。 */
  onRangeChange?: (range: { startFrame: number; endFrame: number } | null) => void;
  /** v0.21.14 · 时间轴 Shift+拖刷选回填的范围 (覆盖预设/方向派生的范围); 每次刷选传新对象。 */
  brushedRange?: { startFrame: number; endFrame: number } | null;
  /** v0.21.27 · U-pvs-1 · PVS 点种子采集 (仅 sam3_video_interactive)。开启后画布点击落归一化种子点。 */
  seedCollecting?: boolean;
  /** 已落种子点数。 */
  seedPointCount?: number;
  /** 切换「落点选目标」采集态 (进入时画布切 smart-point、退出复原)。 */
  onToggleSeedCollecting?: () => void;
  /** 清空已落种子点。 */
  onClearSeeds?: () => void;
  /** 已落目标数 (distinct obj); >1 时显示「M 目标」。 */
  seedTargetCount?: number;
  /** 新目标: 当前目标已落点后, 后续点归入下一目标 (各成一条轨迹)。 */
  onNewSeedTarget?: () => void;
  /** 落点跨的帧数 (distinct frame); >1 = 纠偏多帧累积 prompt。 */
  seedFrameCount?: number;
}

export function VideoTrackerPropagateDialog({
  open,
  frameIndex,
  maxFrame,
  nextKeyframeAfter,
  prevKeyframeBefore = null,
  userId,
  samplingStep = 1,
  projectDefaultModel = null,
  preferNonMockModel = false,
  supportedTrackers,
  textDrivenTrackers,
  isPolylineTrack = false,
  submitting,
  onCancel,
  onSubmit,
  onRangeChange,
  brushedRange = null,
  seedCollecting = false,
  seedPointCount = 0,
  onToggleSeedCollecting,
  onClearSeeds,
  seedTargetCount = 0,
  onNewSeedTarget,
  seedFrameCount = 0,
}: VideoTrackerPropagateDialogProps) {
  const [direction, setDirection] = useState<VideoTrackerDirection>("forward");
  const [rangePreset, setRangePreset] = useState<RangePresetValue>("30");
  const [modelKey, setModelKey] = useState<string>("mock_bbox");
  // v0.10.36: SAM 模型尺寸; 空 = 默认 (tiny)。
  const [samVariant, setSamVariant] = useState<string>("");
  // v0.21.19: text-driven 追踪 (sam3_video) 的文本 query; 每次打开重置 (非持久化)。
  const [text, setText] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  // v0.21.14 · 时间轴 Shift+拖刷选回填的自定义范围; 非 null 时覆盖预设/方向派生的范围。
  // 改预设 / 方向即清空 (回到派生范围)。
  const [customRange, setCustomRange] = useState<{ from: number; to: number } | null>(null);

  // v0.21.14 · 项目已绑真实 tracker 后端 (preferNonMockModel) 时从下拉过滤掉测试用 mock_bbox,
  // 避免误选跑出假框; 未绑后端 / 测试环境仍保留 mock 可见。过滤后的表也用于默认模型解析,
  // 使记忆里残留的 mock_bbox 不再复现 (不在候选 → 回退到首个真实模型)。
  const modelOptions = useMemo(
    () =>
      preferNonMockModel
        ? TRACKER_MODEL_OPTIONS.filter((m) => m.value !== "mock_bbox")
        : TRACKER_MODEL_OPTIONS,
    [preferNonMockModel],
  );

  // v0.21.19 · text-driven 判定 + 能力灰置。sam3_video 天然 text-driven (backend 未声明前
  // 也据静态兜底显 text 框); text-driven tracker 仅在 backend /setup 的 supported_trackers
  // 声明后可选, 否则灰置 (不做假占位可点)。mock_bbox / sam2_video 不受此门控 (零回归)。
  const isTextDrivenModel = useMemo(() => {
    const set = new Set(textDrivenTrackers ?? []);
    return (value: string) => set.has(value) || value === "sam3_video";
  }, [textDrivenTrackers]);
  const isModelDisabled = useMemo(() => {
    const supported = new Set(supportedTrackers ?? []);
    return (value: string) => isTextDrivenModel(value) && !supported.has(value);
  }, [supportedTrackers, isTextDrivenModel]);

  const textDrivenActive = isTextDrivenModel(modelKey);
  const selectedModelDisabled = isModelDisabled(modelKey);

  useEffect(() => {
    if (open) {
      const remembered =
        readDialogMemory(userId, "trackerPropagate", validateTrackerMemory) ??
        DEFAULT_TRACKER_MEMORY;
      setDirection(remembered.direction);
      setRangePreset(remembered.rangePreset);
      setModelKey(resolveTrackerDefaultModel({
        projectDefaultModel,
        rememberedModel: remembered.modelKey,
        preferNonMockModel,
        options: modelOptions,
      }));
      setSamVariant(remembered.samVariant);
      setText("");
      setError(null);
      setCustomRange(null);
    }
  }, [open, preferNonMockModel, projectDefaultModel, userId, modelOptions]);

  // 时间轴 Shift+拖刷选 → 覆盖为自定义范围 (每次刷选传新对象, 故按引用触发)。
  useEffect(() => {
    if (!open || !brushedRange) return;
    setCustomRange({ from: brushedRange.startFrame, to: brushedRange.endFrame });
  }, [open, brushedRange]);

  const grid = Math.max(1, Math.round(samplingStep));

  const derivedRange = useMemo(() => {
    if (rangePreset === "next-keyframe") {
      // 向前(backward): 传播到上一关键帧; 无上一关键帧时回退固定跨度。其余方向: 到下一关键帧。
      if (direction === "backward") {
        if (prevKeyframeBefore !== null && prevKeyframeBefore < frameIndex) {
          return { from: prevKeyframeBefore, to: frameIndex };
        }
        return { from: Math.max(0, frameIndex - 30), to: frameIndex };
      }
      if (nextKeyframeAfter !== null && nextKeyframeAfter > frameIndex) {
        return { from: frameIndex, to: nextKeyframeAfter };
      }
      return { from: frameIndex, to: Math.min(maxFrame, frameIndex + 30) };
    }
    if (rangePreset === "end") {
      return direction === "backward"
        ? { from: 0, to: frameIndex }
        : { from: frameIndex, to: maxFrame };
    }
    // 数字预设是网格格子数; 采样开启时换算成源帧跨度 (span * grid)。
    const span = Number(rangePreset) * grid;
    if (direction === "backward") {
      return { from: Math.max(0, frameIndex - span), to: frameIndex };
    }
    if (direction === "bidirectional") {
      return {
        from: Math.max(0, frameIndex - span),
        to: Math.min(maxFrame, frameIndex + span),
      };
    }
    return { from: frameIndex, to: Math.min(maxFrame, frameIndex + span) };
  }, [direction, frameIndex, grid, maxFrame, nextKeyframeAfter, prevKeyframeBefore, rangePreset]);

  // 自定义范围 (来自时间轴刷选) 优先; 否则用预设/方向派生的范围。
  const range = customRange ?? derivedRange;

  // v0.21.27 · U-pvs-3 · U6: 当前范围粗估窗口数 (>1 时提示大范围将分多窗处理)。
  const estimatedWindows = estimateWindowCount(range.to - range.from, modelKey);

  // v0.21.14 WS3 · 把当前影响范围上报给时间轴高亮; 关闭 / 卸载时清空。
  useEffect(() => {
    if (!open) {
      onRangeChange?.(null);
      return;
    }
    onRangeChange?.({ startFrame: range.from, endFrame: range.to });
    return () => onRangeChange?.(null);
  }, [open, range.from, range.to, onRangeChange]);

  // v0.21.14 · 浮层化后无遮罩, 用 Esc 关闭 (替代原点击遮罩关闭)。
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const handleSubmit = async () => {
    if (isPolylineTrack) {
      setError("polyline 轨迹传播暂不支持");
      return;
    }
    if (range.from > range.to) {
      setError("起止帧无效");
      return;
    }
    if (selectedModelDisabled) {
      setError("该 tracker 未由 backend 声明支持, 暂不可用");
      return;
    }
    // v0.21.19 · text-driven tracker 必须有文本描述 (否则每帧无检测依据)。
    const trimmedText = text.trim();
    if (textDrivenActive && !trimmedText) {
      setError("文本驱动追踪需填写文本描述");
      return;
    }
    try {
      await onSubmit({
        from_frame: range.from,
        to_frame: range.to,
        model_key: modelKey,
        direction,
        sam_variant: samVariant || undefined,
        text: textDrivenActive ? trimmedText : undefined,
      });
      writeDialogMemory(userId, "trackerPropagate", {
        rangePreset,
        direction,
        modelKey,
        samVariant,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "提交失败");
    }
  };

  return (
    // v0.21.27 · U-pvs-1 · 形式统一: 采用与 SAM 交互工具条 (InteractiveToolBar) 同款顶部居中
    // 悬浮工具条 chrome (横排紧凑, 共享 workbenchToolbarChrome)。仍 fixed·top-16·让出底部
    // 时间轴、无遮罩 (原全屏 modal 会遮住时间轴, 看不到范围高亮 / 无法刷选)。Esc / ✕ / 取消 关闭。
    <div
      role="dialog"
      aria-label="AI 追踪传播"
      data-testid="video-tracker-propagate-dialog"
      className={cn(
        "fixed left-1/2 top-16 z-workbench-modal max-w-[calc(100%-1.5rem)] -translate-x-1/2",
        TOOLBAR_CHROME_CLASS,
      )}
    >
      {/* 主行: 标题 | 方向 | 范围 | 模型 | 种子/文本 | 尺寸 | 动作 (横排, 溢出折行) */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex shrink-0 items-center gap-1.5">
          <b className="whitespace-nowrap text-xs">AI 追踪</b>
          <span className="text-2xs text-muted-foreground">Ctrl+B</span>
        </div>

        {TOOLBAR_DIVIDER}

        {/* 方向 (分段按钮) */}
        <div className="flex items-center gap-1.5">
          <span className={TOOLBAR_FIELD_LABEL_CLASS}>方向</span>
          <div className="flex divide-x divide-border overflow-hidden rounded-sm border border-border">
            {(["forward", "backward", "bidirectional"] as VideoTrackerDirection[]).map((d) => (
              <button
                key={d}
                type="button"
                data-testid={`tracker-direction-${d}`}
                title={DIRECTION_META[d].title}
                onClick={() => {
                  setDirection(d);
                  setCustomRange(null);
                }}
                className={cn(
                  "cursor-pointer whitespace-nowrap px-1.5 py-1 text-xs",
                  direction === d
                    ? "bg-status-info-soft text-foreground"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {DIRECTION_META[d].label}
              </button>
            ))}
          </div>
        </div>

        {TOOLBAR_DIVIDER}

        {/* 范围 (combobox 0) */}
        <div className="flex items-center gap-1.5">
          <span className={TOOLBAR_FIELD_LABEL_CLASS}>范围</span>
          <select
            value={rangePreset}
            onChange={(e) => {
              setRangePreset(e.target.value as RangePresetValue);
              setCustomRange(null);
            }}
            className={cn(TOOLBAR_SELECT_CLASS, "cursor-pointer")}
          >
            {RANGE_PRESETS.map((preset) => (
              <option key={preset} value={preset}>
                {presetLabel(preset, grid)}
              </option>
            ))}
          </select>
        </div>

        {TOOLBAR_DIVIDER}

        {/* 模型 (combobox 1) */}
        <div className="flex items-center gap-1.5">
          <span className={TOOLBAR_FIELD_LABEL_CLASS}>模型</span>
          <select
            value={modelKey}
            onChange={(e) => setModelKey(e.target.value)}
            className={cn(TOOLBAR_SELECT_CLASS, "cursor-pointer")}
          >
            {modelOptions.map((m) => {
              const disabled = isModelDisabled(m.value);
              return (
                <option key={m.value} value={m.value} disabled={disabled}>
                  {m.label}
                  {disabled ? " (未绑定后端)" : ""}
                </option>
              );
            })}
          </select>
        </div>

        {/* 模型尺寸 (combobox 2) — 非 mock */}
        {modelKey !== "mock_bbox" && (
          <>
            {TOOLBAR_DIVIDER}
            <div className="flex items-center gap-1.5">
              <span className={TOOLBAR_FIELD_LABEL_CLASS}>尺寸</span>
              <select
                value={samVariant}
                onChange={(e) => setSamVariant(e.target.value)}
                className={cn(TOOLBAR_SELECT_CLASS, "cursor-pointer")}
              >
                {SAM_VARIANTS.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        {TOOLBAR_DIVIDER}

        {/* 动作 */}
        <div className="flex shrink-0 items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={submitting}>
            取消
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={submitting || selectedModelDisabled || isPolylineTrack}
            title={isPolylineTrack ? "polyline 轨迹传播暂不支持" : undefined}
          >
            {submitting ? "发起中…" : "发起传播"}
          </Button>
          <button
            type="button"
            onClick={onCancel}
            aria-label="关闭"
            className="cursor-pointer border-0 bg-transparent text-sm text-muted-foreground"
          >
            ✕
          </button>
        </div>
      </div>

      {/* v0.21.27 · U-pvs-3 · #4 · 第二行: 种子/文本 (仅交互/文本驱动)。独立成行 →
          宽度随落点计数/文本变化时不再挤动主行的「发起传播」等动作按钮; 跨 backend
          行数可预测 (有此行 iff 交互或文本驱动)。二者互斥 (交互非 text-driven)。 */}
      {(modelKey === "sam3_video_interactive" || textDrivenActive) && (
        <div className="flex flex-wrap items-center gap-2">
          {modelKey === "sam3_video_interactive" && (
            <div className="flex items-center gap-1.5">
              <span className={TOOLBAR_FIELD_LABEL_CLASS}>种子</span>
              <button
                type="button"
                onClick={onToggleSeedCollecting}
                disabled={submitting}
                data-testid="tracker-seed-toggle"
                className={cn(
                  "cursor-pointer rounded-sm border px-1.5 py-1 text-xs text-foreground",
                  seedCollecting
                    ? "border-violet-600 bg-status-info-soft dark:border-violet-400"
                    : "border-border bg-muted",
                )}
              >
                {seedCollecting ? "落点中…" : "落点选目标"}
              </button>
              {seedPointCount > 0 && (
                <>
                  <button
                    type="button"
                    onClick={onNewSeedTarget}
                    disabled={submitting}
                    data-testid="tracker-seed-new-target"
                    title="后续落点归入新目标 (各成一条轨迹)"
                    className="cursor-pointer rounded-sm border border-border bg-muted px-1.5 py-1 text-xs text-foreground"
                  >
                    + 新目标
                  </button>
                  <span
                    data-testid="tracker-seed-count"
                    className="text-2xs text-foreground"
                  >
                    已落 {seedPointCount} 点
                    {seedTargetCount > 1 ? ` · ${seedTargetCount} 目标` : ""}
                    {seedFrameCount > 1 ? ` · ${seedFrameCount} 帧` : ""}
                  </span>
                  <button
                    type="button"
                    onClick={onClearSeeds}
                    disabled={submitting}
                    className="cursor-pointer border-0 bg-transparent text-2xs text-muted-foreground underline"
                  >
                    清空
                  </button>
                </>
              )}
            </div>
          )}
          {textDrivenActive && (
            <div className="flex items-center gap-1.5">
              <span className={TOOLBAR_FIELD_LABEL_CLASS}>文本</span>
              <input
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="如: the red car"
                data-testid="tracker-text-input"
                className="w-32 rounded-sm border border-border bg-muted px-1.5 py-1 text-xs text-foreground placeholder:text-muted-foreground"
              />
            </div>
          )}
        </div>
      )}

      {/* 次行: 范围预览 + 提示 + 警告 + 错误 (折行, 对齐 InteractiveToolBar 的次行) */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-2xs text-muted-foreground">
        <span className="mono">
          {grid > 1 ? (
            <>
              G{Math.round(range.from / grid)} → G{Math.round(range.to / grid)} (F
              {range.from} → F{range.to})
            </>
          ) : (
            <>
              F{range.from} → F{range.to}
            </>
          )}
          {customRange && (
            <span data-testid="tracker-range-custom" className="ml-1.5 text-brand">
              · 自定义
            </span>
          )}
        </span>
        <span>按住 Shift 在时间轴拖选可圈定范围</span>
        {/* v0.21.27 · U-pvs-3 · U6: 大范围分窗提示 (>1 窗)。 */}
        {estimatedWindows > 1 && (
          <span data-testid="tracker-window-estimate">
            ≈{estimatedWindows} 窗 (大范围分窗处理 · 粗估)
          </span>
        )}
        {/* v0.21.27 · U-pvs-3 · U5 (+ #3 语义兜底): 多目标感知按模型分述。 */}
        {modelKey === "sam3_video_interactive" && (
          <span>
            点目标落正点 (Alt 负点); obj1 回填选中轨迹, 「+新目标」各成新轨迹; 导航别帧再落点 =
            多帧纠偏; 无落点则用选中轨迹框
          </span>
        )}
        {modelKey === "sam2_video" && <span>框种子: 跟随所选轨迹的单个目标</span>}
        {textDrivenActive && <span>文本驱动: 按描述在每帧自动发现并追踪多个目标</span>}
        {selectedModelDisabled && (
          <span className="text-status-caution">
            该 tracker 需项目绑定并由 backend 声明支持 (未声明, 暂不可用)
          </span>
        )}
        {isPolylineTrack && (
          <span
            data-testid="tracker-polyline-unsupported"
            className="text-status-danger"
          >
            polyline 轨迹传播暂不支持
          </span>
        )}
        {error && <span className="text-status-danger">{error}</span>}
      </div>
    </div>
  );
}
