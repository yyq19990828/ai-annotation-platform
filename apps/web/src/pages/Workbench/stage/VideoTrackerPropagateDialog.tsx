import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import type {
  VideoTrackerDirection,
  VideoTrackerPropagatePayload,
} from "@/api/videoTracker";
import { readDialogMemory, writeDialogMemory } from "../state/videoDialogMemory";

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

export const TRACKER_MODEL_OPTIONS: Array<{ value: string; label: string; note?: string }> = [
  { value: "mock_bbox", label: "mock_bbox", note: "测试用 (不依赖 ML backend)" },
  { value: "sam2_video", label: "sam2_video", note: "需项目绑定 ML backend" },
  { value: "sam3_video", label: "sam3_video", note: "文本检测追踪 · 需项目绑定 ML backend" },
  // v0.21.26 · 阶段 B-pvs · SAM3 交互追踪 (点/框 seed + memory 跨帧, 非文本驱动)。与
  // sam2_video 同为种子传播 (不显 text 框); 需绑定声明该 tracker 的 sam3 backend。
  {
    value: "sam3_video_interactive",
    label: "sam3_video_interactive",
    note: "点/框交互追踪 · 需项目绑定 sam3 backend",
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
    // v0.21.14 · 浮层化 (原全屏 modal 会遮住底部时间轴, 看不到传播范围高亮 / 无法刷选)。
    // 定位在顶部居中, 不覆盖底部时间轴; 无遮罩, 时间轴保持可见可交互。Esc / ✕ / 取消 关闭。
    <div
      role="dialog"
      aria-label="AI 追踪传播"
      data-testid="video-tracker-propagate-dialog"
      className="fixed left-1/2 top-16 -translate-x-1/2 z-workbench-modal grid gap-3 w-[360px] p-4 border border-border rounded-[10px] bg-card shadow-2xl"
    >
        <div className="flex items-center justify-between">
          <b className="text-sm">AI 追踪 (Ctrl+B)</b>
          <button
            type="button"
            onClick={onCancel}
            className="border-0 bg-transparent text-muted-foreground cursor-pointer text-sm"
          >
            ✕
          </button>
        </div>

        {isPolylineTrack && (
          <div
            data-testid="tracker-polyline-unsupported"
            className="text-status-danger text-xs"
          >
            polyline 轨迹传播暂不支持
          </div>
        )}

        <label className="grid gap-1 text-muted-foreground text-xs">
          方向
          <div className="grid grid-cols-3 gap-1">
            {(["forward", "backward", "bidirectional"] as VideoTrackerDirection[]).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => {
                  setDirection(d);
                  setCustomRange(null);
                }}
                className={cn(
                  "py-1.5 border rounded-md bg-background text-foreground cursor-pointer text-xs",
                  direction === d
                    ? "border-violet-600 dark:border-violet-400 bg-status-info-soft"
                    : "border-border",
                )}
              >
                {d === "forward" ? "向后" : d === "backward" ? "向前" : "双向"}
              </button>
            ))}
          </div>
        </label>

        <label className="grid gap-1 text-muted-foreground text-xs">
          范围
          <select
            value={rangePreset}
            onChange={(e) => {
              setRangePreset(e.target.value as RangePresetValue);
              setCustomRange(null);
            }}
            className="py-1.5 px-2 border border-border rounded-md bg-background text-foreground text-sm cursor-pointer"
          >
            {RANGE_PRESETS.map((preset) => (
              <option key={preset} value={preset}>
                {presetLabel(preset, grid)}
              </option>
            ))}
          </select>
          <span className={cn("mono", "text-muted-foreground text-xs")}>
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
              <span data-testid="tracker-range-custom" className="ml-1.5 text-brand">· 自定义</span>
            )}
          </span>
          <span className="text-muted-foreground text-2xs">
            按住 Shift 在时间轴上拖选可直接圈定范围
          </span>
        </label>

        <label className="grid gap-1 text-muted-foreground text-xs">
          模型
          <select
            value={modelKey}
            onChange={(e) => setModelKey(e.target.value)}
            className="py-1.5 px-2 border border-border rounded-md bg-background text-foreground text-sm cursor-pointer"
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
          <span className="text-muted-foreground text-xs">
            {selectedModelDisabled
              ? "该 tracker 需项目绑定并由 backend 声明支持 (未声明, 暂不可用)"
              : modelOptions.find((m) => m.value === modelKey)?.note}
          </span>
        </label>

        {textDrivenActive && (
          <label className="grid gap-1 text-muted-foreground text-xs">
            文本描述
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="如: the red car / a person walking"
              data-testid="tracker-text-input"
              className="py-1.5 px-2 border border-border rounded-md bg-background text-foreground text-sm"
            />
            <span className="text-muted-foreground text-xs">
              文本驱动追踪: 按描述在每帧检测目标 (而非从种子框传播)。
            </span>
          </label>
        )}

        {modelKey !== "mock_bbox" && (
          <label className="grid gap-1 text-muted-foreground text-xs">
            模型尺寸
            <select
              value={samVariant}
              onChange={(e) => setSamVariant(e.target.value)}
              className="py-1.5 px-2 border border-border rounded-md bg-background text-foreground text-sm cursor-pointer"
            >
              {SAM_VARIANTS.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>
            <span className="text-muted-foreground text-xs">
              更大尺寸更准但更慢/更吃显存; 默认 tiny。
            </span>
          </label>
        )}

        {error && (
          <div className="text-status-danger text-xs">{error}</div>
        )}

        <div className="flex gap-2 justify-end">
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
        </div>
    </div>
  );
}
