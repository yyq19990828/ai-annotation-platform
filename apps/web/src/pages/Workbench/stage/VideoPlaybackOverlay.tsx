import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { getTrackColor } from "./colors";
import { frameToTime, type FrameTimebase } from "./frameTimebase";
import { frameToPct, pctToFrame, type TimelineWindow } from "./timelineCoords";
import type { VideoBookmark, VideoLoopRegion } from "./videoNavigationState";
import type { VideoFramePreview } from "./useVideoFramePreview";
import type { PredictionDensityBin, VideoTimelineDensityBin, VideoTrackTimeline } from "./videoTrackTimeline";
import styles from "./VideoPlaybackOverlay.module.css";

type HighlightAction = "prev" | "next" | "play" | null;
type CSSVars = Record<`--${string}`, string | number>;

// 密度柱最大像素高度。人工/AI 两条 lane 共用同一 max 计数与同一柱高上限,
// 柱高才能跨 lane 直接反映数量占比 (见 densityScaleMax)。
const DENSITY_BAR_MAX_PX = 9;
export type VideoLargeFrameStep = 5 | 10 | 30 | "grid";

export interface VideoTimelineChapter {
  id: string;
  startFrame: number;
  endFrame: number;
  title: string;
  color?: string | null;
}

/**
 * v0.21.13 · 时间轴区间刷选的用途。决定松手后 {from,to} 交给谁、草稿带用什么样式渲染。
 * - `loop`: 循环播放区间 (原行为, 零回归)。
 * - `chapter-draft`: 圈一段预填章节表单 (WS2)。
 * - `propagate-range`: 圈一段喂给 AI 传播对话框 (v0.21.14 WS3)。
 */
export type TimelineRangePurpose = "loop" | "chapter-draft" | "propagate-range";

interface TimelineRangeDraft {
  region: VideoLoopRegion;
  purpose: TimelineRangePurpose;
}

/**
 * v0.21.13 · 章节 × 时间轴联动的一组控制器, 从 shell 经 StageHost / VideoWorkbench 透传到本组件。
 * 分批填充: WS2 刷选建章节 (rangeSelectPurpose + onRangeSelect); WS3 章节条 resize (onResizeChapter);
 * WS4 双向 hover (hoveredChapterId + onHoverChapter)。非视频任务不传。
 */
export interface VideoTimelineChapterControls {
  rangeSelectPurpose: TimelineRangePurpose;
  onRangeSelect: (purpose: TimelineRangePurpose, region: VideoLoopRegion) => void;
  hoveredChapterId?: string | null;
  onHoverChapter?: (chapterId: string | null) => void;
  onResizeChapter?: (chapterId: string, region: VideoLoopRegion) => void;
}

const RANGE_DRAFT_TESTID: Record<TimelineRangePurpose, string> = {
  loop: "video-loop-region-preview",
  "chapter-draft": "video-timeline-chapter-draft",
  "propagate-range": "video-timeline-propagate-draft",
};

interface VideoPlaybackOverlayProps {
  frameIndex: number;
  maxFrame: number;
  /** v0.10.29 · 采样网格步长 (源帧空间)。>1 时在时间轴渲染网格刻度；1 时不画。 */
  samplingStep?: number;
  /** v0.15.5 · 时间轴聚焦时 Shift+←/→ 的大步进策略。 */
  largeFrameStep?: VideoLargeFrameStep;
  timebase: FrameTimebase;
  isPlaying: boolean;
  playbackRateLabel?: string;
  selectedTrackTimeline?: VideoTrackTimeline | null;
  /** 选中轨迹的显示色 (oklch 字符串); 关键帧点用它着色, 与画布框/侧栏同源。 */
  trackColor?: string | null;
  globalTimelineDensity?: VideoTimelineDensityBin[];
  /** v0.21.9 · AI 预测密度轨 (bucket 化, 单 violet 色); 与人工密度条独立叠加。 */
  predictionDensity?: PredictionDensityBin[];
  /** v0.21.9 · 跳到下一个/上一个有预测的帧; undefined 时不渲染导航按钮 (无预测帧)。 */
  onSeekPredicted?: (dir: -1 | 1) => void;
  /** 会话级轨迹色覆盖; 密度条按各 bin 的主导轨迹着色时用它解析颜色。 */
  trackColorOverrides?: Record<string, string>;
  loopRegion?: VideoLoopRegion | null;
  /** v0.21.14 WS3 · AI 传播对话框打开时在时间轴高亮「将影响哪段帧」(受控静态带, 非刷选草稿)。 */
  propagateRange?: VideoLoopRegion | null;
  /** v0.21.13 · 时间轴刷选产物的用途 (默认 "loop", 原行为)。非 loop 时松手走 onRangeSelect。 */
  rangeSelectPurpose?: TimelineRangePurpose;
  bookmarks?: VideoBookmark[];
  chapters?: VideoTimelineChapter[];
  /** v0.11.7 · 含 pixel-anchored issue 的帧 (时间轴上加标记, 单击跳转)。 */
  issueFrames?: number[];
  hoverPreview?: VideoFramePreview | null;
  currentFrameEntryCount: number;
  visible: boolean;
  interactive?: boolean;
  highlightAction?: HighlightAction;
  onSeek: (frameIndex: number) => void;
  onSeekByFrames: (delta: number) => void;
  onTogglePlay: () => void;
  onLoopRegionChange?: (region: VideoLoopRegion) => void;
  onClearLoopRegion?: () => void;
  onSeekBookmark?: (frameIndex: number) => void;
  onHoverFrameChange?: (frameIndex: number | null) => void;
  onSeekChapter?: (chapterId: string, frameIndex: number) => void;
  /** v0.21.13 · 非 loop 用途的区间刷选提交 (松手时按 rangeSelectPurpose 分派)。 */
  onRangeSelect?: (purpose: TimelineRangePurpose, region: VideoLoopRegion) => void;
  /** v0.21.13 WS4 · 时间轴章节条 ↔ 侧栏行双向 hover 联动。 */
  hoveredChapterId?: string | null;
  onHoverChapter?: (chapterId: string | null) => void;
  /** v0.21.13 WS3 · 章节色条边界 resize 提交 (拖动松手, debounce PATCH 在 shell)。 */
  onChapterResize?: (chapterId: string, region: VideoLoopRegion) => void;
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "00:00.000";
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`;
}

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

// 密度条半透明色: 轨迹色 (oklch) 或 accent token 兑入透明, 避免密度条过抢眼。
function densityTint(color: string) {
  return `color-mix(in oklch, ${color} 68%, transparent)`;
}

export function resolveLargeFrameStep(
  largeFrameStep: VideoLargeFrameStep,
  samplingStep: number,
): number {
  if (largeFrameStep !== "grid") return largeFrameStep;
  return samplingStep > 1 ? samplingStep : 10;
}

/**
 * 按比例分级着色: 把一个密度 bin 按各轨迹关键帧占比, 自底向上堆叠成彩色渐变 (类似堆叠柱状),
 * 占比 = 该轨迹 count / bin 总 density; 差额 (legacy bbox, 无轨迹归属) 用 accent 兜底补满。
 */
export function densityBinGradient(
  bin: VideoTimelineDensityBin,
  overrides?: Record<string, string>,
): string {
  const total = bin.density > 0 ? bin.density : 1;
  const pct = (n: number) => `${((n / total) * 100).toFixed(2)}%`;
  const stops: string[] = [];
  let acc = 0;
  for (const share of bin.tracks) {
    const tint = densityTint(getTrackColor(share.trackId, "", overrides));
    const start = acc;
    acc += share.count;
    stops.push(`${tint} ${pct(start)}`, `${tint} ${pct(acc)}`);
  }
  if (acc < total) {
    const tint = densityTint("var(--sc-brand)");
    stops.push(`${tint} ${pct(acc)}`, `${tint} 100%`);
  }
  return `linear-gradient(to top, ${stops.join(", ")})`;
}

function useCssVars<T extends HTMLElement>(vars: CSSVars) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    Object.entries(vars).forEach(([key, value]) => {
      el.style.setProperty(key, String(value));
    });
  }, [vars]);
  return ref;
}

function TimelineSpan({ vars, ...props }: HTMLAttributes<HTMLSpanElement> & { vars: CSSVars }) {
  const ref = useCssVars<HTMLSpanElement>(vars);
  return <span ref={ref} {...props} />;
}

function TimelineButton({ vars, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { vars: CSSVars }) {
  const ref = useCssVars<HTMLButtonElement>(vars);
  return <button ref={ref} {...props} />;
}

function TimelineDiv({ vars, ...props }: HTMLAttributes<HTMLDivElement> & { vars: CSSVars }) {
  const ref = useCssVars<HTMLDivElement>(vars);
  return <div ref={ref} {...props} />;
}

export function VideoPlaybackOverlay({
  frameIndex,
  maxFrame,
  samplingStep = 1,
  largeFrameStep = 10,
  timebase,
  isPlaying,
  playbackRateLabel,
  selectedTrackTimeline = null,
  trackColor = null,
  globalTimelineDensity = [],
  predictionDensity = [],
  onSeekPredicted,
  trackColorOverrides,
  loopRegion = null,
  propagateRange = null,
  rangeSelectPurpose = "loop",
  bookmarks = [],
  chapters = [],
  issueFrames = [],
  hoverPreview = null,
  currentFrameEntryCount,
  visible,
  interactive = true,
  highlightAction = null,
  onSeek,
  onSeekByFrames,
  onTogglePlay,
  onLoopRegionChange,
  onClearLoopRegion,
  onSeekBookmark,
  onHoverFrameChange,
  onSeekChapter,
  onRangeSelect,
  hoveredChapterId = null,
  onHoverChapter,
  onChapterResize,
}: VideoPlaybackOverlayProps) {
  const [hoverFrame, setHoverFrame] = useState<number | null>(null);
  const [rangeDraft, setRangeDraft] = useState<TimelineRangeDraft | null>(null);
  // v0.21.13 WS3 · 章节条边界 resize 的本地预览 (拖动中不落库, 松手才 onChapterResize → debounce PATCH)。
  const [chapterResizePreview, setChapterResizePreview] = useState<
    { id: string; startFrame: number; endFrame: number } | null
  >(null);
  const chapterResizeRef = useRef<
    { id: string; edge: "start" | "end"; startFrame: number; endFrame: number } | null
  >(null);
  const rangeDraftRef = useRef<TimelineRangeDraft | null>(null);
  const seekDragRef = useRef(false);
  const timelineShellRef = useRef<HTMLDivElement | null>(null);
  const hoverFrameRef = useRef<number | null>(null);
  const frameTooltip = useMemo(() => {
    if (hoverFrame === null) return null;
    return `F ${hoverFrame} · ${formatTime(frameToTime(hoverFrame, timebase))}`;
  }, [hoverFrame, timebase]);
  // 人工关键帧密度与 AI 候选密度共用同一计数基准, 使两条 lane 的柱高可以直接横向比较。
  // 否则各自独立归一化会让「1 个关键帧」和「8 个候选」都撑满各自 lane, 把 1:8 的真实比例
  // 画成等高甚至倒挂 (关键帧反而更高)。共享 max 后, 柱高才真实反映数量占比。
  const densityScaleMax = useMemo(
    () => Math.max(
      1,
      ...globalTimelineDensity.map((bin) => bin.density),
      ...predictionDensity.map((bin) => bin.count),
    ),
    [globalTimelineDensity, predictionDensity],
  );
  // v0.10.29 · 采样网格刻度：step>1 时在时间轴渲染网格帧 tick。
  // 网格点过密时 (>200) 按比例抽稀，避免长视频生成海量 DOM 节点。
  const gridTicks = useMemo(() => {
    if (samplingStep <= 1 || maxFrame <= 0) return [];
    const total = Math.floor(maxFrame / samplingStep) + 1;
    const stride = total > 200 ? Math.ceil(total / 200) : 1;
    const ticks: number[] = [];
    for (let i = 0; i < total; i += stride) {
      const frame = Math.min(maxFrame, i * samplingStep);
      if (frame <= 0 || frame >= maxFrame) continue;
      ticks.push(frame);
    }
    return ticks;
  }, [maxFrame, samplingStep]);
  const currentFrameOffGrid = !isPlaying && samplingStep > 1 && frameIndex % samplingStep !== 0;
  // v0.21.15 WS1 · 可见帧窗口。WS1 固定为全窗口 {0, maxFrame} —— 零行为变更; WS2 起改为可缩放状态。
  const timelineWindow: TimelineWindow = { from: 0, to: maxFrame };
  const frameLeft = (frame: number) => `${frameToPct(frame, timelineWindow)}%`;
  const frameFromPointer = (clientX: number, rect: DOMRect) => {
    const pointerX = Number.isFinite(clientX) ? clientX : rect.left;
    const ratio = rect.width > 0 ? (pointerX - rect.left) / rect.width : 0;
    return pctToFrame(ratio, timelineWindow);
  };
  // v0.21.13 WS3 · 章节条边界 resize。命中区: 章节条左右边缘各一把手 (data-chapter-resize),
  // 拖动改起/止帧, 松手才 onChapterResize (shell debounce PATCH); 中间仍点选 seek。
  const beginChapterResize = (
    e: ReactPointerEvent<HTMLElement>,
    chapter: VideoTimelineChapter,
    edge: "start" | "end",
  ) => {
    e.preventDefault();
    e.stopPropagation();
    chapterResizeRef.current = {
      id: chapter.id,
      edge,
      startFrame: chapter.startFrame,
      endFrame: chapter.endFrame,
    };
    setChapterResizePreview({
      id: chapter.id,
      startFrame: chapter.startFrame,
      endFrame: chapter.endFrame,
    });
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const moveChapterResize = (e: ReactPointerEvent<HTMLElement>) => {
    const st = chapterResizeRef.current;
    const shell = timelineShellRef.current;
    if (!st || !shell) return;
    e.preventDefault();
    e.stopPropagation();
    const frame = frameFromPointer(e.clientX, shell.getBoundingClientRect());
    const next =
      st.edge === "start"
        ? { ...st, startFrame: Math.max(0, Math.min(frame, st.endFrame)) }
        : { ...st, endFrame: Math.min(maxFrame, Math.max(frame, st.startFrame)) };
    chapterResizeRef.current = next;
    setChapterResizePreview({ id: next.id, startFrame: next.startFrame, endFrame: next.endFrame });
  };
  const endChapterResize = (e: ReactPointerEvent<HTMLElement>) => {
    const st = chapterResizeRef.current;
    chapterResizeRef.current = null;
    setChapterResizePreview(null);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (!st) return;
    const original = chapters.find((c) => c.id === st.id);
    if (original && (original.startFrame !== st.startFrame || original.endFrame !== st.endFrame)) {
      onChapterResize?.(st.id, { startFrame: st.startFrame, endFrame: st.endFrame });
    }
  };
  const normalizeLoop = (from: number, to: number): VideoLoopRegion => ({
    startFrame: Math.min(from, to),
    endFrame: Math.max(from, to),
  });
  const updateHoverFrame = (nextFrame: number | null) => {
    if (hoverFrameRef.current === nextFrame) return;
    hoverFrameRef.current = nextFrame;
    setHoverFrame(nextFrame);
    onHoverFrameChange?.(nextFrame);
  };
  const rangeStyle = (from: number, to: number): CSSVars => {
    const left = frameToPct(from, timelineWindow);
    const right = frameToPct(to, timelineWindow);
    return {
      "--timeline-left": `${left}%`,
      "--timeline-width": `${Math.max(0.5, right - left)}%`,
    };
  };
  const stepTimelineByKey = (e: ReactKeyboardEvent, target: HTMLElement) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return false;
    e.preventDefault();
    e.stopPropagation();
    const step = e.shiftKey ? resolveLargeFrameStep(largeFrameStep, samplingStep) : 1;
    onSeekByFrames(e.key === "ArrowRight" ? step : -step);
    target.focus({ preventScroll: true });
    return true;
  };
  const focusTimelineShell = (target: HTMLElement) => {
    const shell = target.closest('[data-testid="video-timeline-shell"]') as HTMLElement | null;
    if (!shell) return;
    window.requestAnimationFrame(() => {
      shell.focus({ preventScroll: true });
    });
  };
  useEffect(() => {
    if (!visible || !interactive) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const shell = timelineShellRef.current;
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !shell) return;
      const isTimelineFocus = active === shell || active.classList.contains("video-timeline-range");
      if (!isTimelineFocus) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      e.stopPropagation();
      const step = e.shiftKey ? resolveLargeFrameStep(largeFrameStep, samplingStep) : 1;
      onSeekByFrames(e.key === "ArrowRight" ? step : -step);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [interactive, largeFrameStep, onSeekByFrames, samplingStep, visible]);
  const hoverLeft = maxFrame > 0 ? ((hoverFrame ?? 0) / maxFrame) * 100 : 0;
  const hoverPopoverLeft = `${Math.max(12, Math.min(88, hoverLeft))}%`;

  const isInteractive = visible && interactive;

  return (
    <div
      data-testid="video-playback-overlay"
      className={cn(styles.overlay, visible ? styles.overlayVisible : styles.overlayHidden)}
    >
      <div className={cn(styles.controls, isInteractive && styles.interactive)}>
        <Button
          size="sm"
          title="上一帧"
          onClick={() => onSeekByFrames(-1)}
          className={cn(styles.controlButton, highlightAction === "prev" && styles.controlButtonActive)}
        >
          <Icon name="chevLeft" size={13} />
        </Button>
        <Button
          size="sm"
          title="播放 / 暂停 (Space)"
          onClick={onTogglePlay}
          className={cn(styles.controlButton, highlightAction === "play" && styles.controlButtonActive)}
        >
          <Icon name={isPlaying ? "pause" : "play"} size={13} />
        </Button>
        <Button
          size="sm"
          title="下一帧"
          onClick={() => onSeekByFrames(1)}
          className={cn(styles.controlButton, highlightAction === "next" && styles.controlButtonActive)}
        >
          <Icon name="chevRight" size={13} />
        </Button>
        {onSeekPredicted && (
          <div className={styles.predictedGroup}>
            <Button
              size="sm"
              title="上一个有预测的帧"
              data-testid="video-seek-prev-predicted"
              onClick={() => onSeekPredicted(-1)}
              className={cn(styles.controlButton, styles.controlButtonPredicted)}
            >
              <Icon name="chevLeft" size={13} />
            </Button>
            <Button
              size="sm"
              title="下一个有预测的帧"
              data-testid="video-seek-next-predicted"
              onClick={() => onSeekPredicted(1)}
              className={cn(styles.controlButton, styles.controlButtonPredicted)}
            >
              <Icon name="chevRight" size={13} />
            </Button>
          </div>
        )}
      </div>

      <div
        data-testid="video-timeline-shell"
        ref={timelineShellRef}
        tabIndex={0}
        className={cn(styles.timelineShell, isInteractive && styles.interactive)}
        onKeyDown={(e) => {
          stepTimelineByKey(e, e.currentTarget);
        }}
        onPointerDownCapture={(e) => {
          // 章节条 resize 把手自行处理 pointer, 不走 shell 的 seek/刷选。
          if ((e.target as HTMLElement)?.closest?.("[data-chapter-resize]")) return;
          e.preventDefault();
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          const frame = frameFromPointer(e.clientX, rect);
          focusTimelineShell(e.currentTarget);
          const brushEnabled =
            rangeSelectPurpose === "loop" ? Boolean(onLoopRegionChange) : Boolean(onRangeSelect);
          // 手势区分: chapter-draft 有显式「圈选」按钮臂选, 普通拖即圈选; loop / propagate-range
          // 保留普通拖 seek/scrub (传播对话框开着时仍能拖动预览帧), 用 Shift+拖 才圈选。
          const plainDragBrushes = rangeSelectPurpose === "chapter-draft";
          const wantsBrush = brushEnabled && (plainDragBrushes || e.shiftKey);
          if (!wantsBrush) {
            seekDragRef.current = true;
            onSeek(frame);
            e.currentTarget.setPointerCapture?.(e.pointerId);
            return;
          }
          const next: TimelineRangeDraft = {
            region: { startFrame: frame, endFrame: frame },
            purpose: rangeSelectPurpose,
          };
          rangeDraftRef.current = next;
          setRangeDraft(next);
          e.currentTarget.setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const frame = frameFromPointer(e.clientX, rect);
          updateHoverFrame(frame);
          const draft = rangeDraftRef.current;
          if (draft) {
            e.preventDefault();
            const next: TimelineRangeDraft = {
              region: normalizeLoop(draft.region.startFrame, frame),
              purpose: draft.purpose,
            };
            rangeDraftRef.current = next;
            setRangeDraft(next);
            return;
          }
          if (seekDragRef.current) {
            e.preventDefault();
            onSeek(frame);
          }
        }}
        onPointerUp={(e) => {
          const draft = rangeDraftRef.current;
          if (draft) {
            e.preventDefault();
            if (draft.purpose === "loop") onLoopRegionChange?.(draft.region);
            else onRangeSelect?.(draft.purpose, draft.region);
            rangeDraftRef.current = null;
            setRangeDraft(null);
            e.currentTarget.releasePointerCapture?.(e.pointerId);
            return;
          }
          if (seekDragRef.current) {
            e.preventDefault();
            seekDragRef.current = false;
            focusTimelineShell(e.currentTarget);
            e.currentTarget.releasePointerCapture?.(e.pointerId);
          }
        }}
        onPointerCancel={(e) => {
          if (!rangeDraftRef.current && !seekDragRef.current) return;
          seekDragRef.current = false;
          rangeDraftRef.current = null;
          setRangeDraft(null);
          e.currentTarget.releasePointerCapture?.(e.pointerId);
        }}
        onPointerLeave={() => {
          if (seekDragRef.current || rangeDraftRef.current) return;
          updateHoverFrame(null);
        }}
      >
        <input
          className={cn("video-timeline-range", styles.rangeInput)}
          aria-label="视频帧时间轴"
          type="range"
          min={0}
          max={maxFrame}
          tabIndex={-1}
          value={frameIndex}
          onChange={(e) => onSeek(Number(e.currentTarget.value))}
          onFocus={(e) => focusTimelineShell(e.currentTarget)}
          onKeyDown={(e) => {
            stepTimelineByKey(e, e.currentTarget);
          }}
          onPointerMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const nextFrame = frameFromPointer(e.clientX, rect);
            updateHoverFrame(nextFrame);
          }}
          onPointerLeave={() => {
            updateHoverFrame(null);
          }}
          onPointerUp={(e) => focusTimelineShell(e.currentTarget)}
        />
        <div className={styles.timelineLayer}>
          {gridTicks.length > 0 && (
            <div data-testid="video-timeline-grid" className={styles.gridTrack}>
              {gridTicks.map((frame) => (
                <TimelineSpan
                  key={`grid-${frame}`}
                  data-testid="video-timeline-grid-tick"
                  className={styles.gridTick}
                  vars={{ "--timeline-left": frameLeft(frame) }}
                />
              ))}
            </div>
          )}
          {currentFrameOffGrid && (
            <TimelineSpan
              data-testid="video-timeline-offgrid-marker"
              className={styles.offGridMarker}
              vars={{ "--timeline-left": frameLeft(frameIndex) }}
            />
          )}
          {loopRegion && rangeDraft?.purpose !== "loop" && (
            <TimelineSpan
              data-testid="video-loop-region"
              className={styles.loopRegion}
              vars={rangeStyle(loopRegion.startFrame, loopRegion.endFrame)}
            />
          )}
          {propagateRange && (
            <TimelineSpan
              data-testid="video-propagate-range"
              className={styles.propagateRegion}
              vars={rangeStyle(propagateRange.startFrame, propagateRange.endFrame)}
            />
          )}
          {rangeDraft && (
            <TimelineSpan
              data-testid={RANGE_DRAFT_TESTID[rangeDraft.purpose]}
              className={cn(
                rangeDraft.purpose === "loop" && cn(styles.loopRegion, styles.loopRegionDraft),
                rangeDraft.purpose === "chapter-draft" && styles.chapterDraftRegion,
                rangeDraft.purpose === "propagate-range" && styles.propagateDraftRegion,
              )}
              vars={rangeStyle(rangeDraft.region.startFrame, rangeDraft.region.endFrame)}
            />
          )}
          {chapters.length > 0 && (
            <div
              data-testid="video-timeline-chapters"
              className={styles.chaptersTrack}
            >
              {chapters.map((chapter) => {
                const preview =
                  chapterResizePreview?.id === chapter.id ? chapterResizePreview : null;
                const startFrame = preview ? preview.startFrame : chapter.startFrame;
                const endFrame = preview ? preview.endFrame : chapter.endFrame;
                const span = Math.max(0, endFrame - startFrame);
                const widthPct = maxFrame > 0 ? ((span + 1) / (maxFrame + 1)) * 100 : 100;
                const leftPct = maxFrame > 0 ? (startFrame / maxFrame) * 100 : 0;
                const rightPct = maxFrame > 0 ? (endFrame / maxFrame) * 100 : 100;
                const chapterStyle: CSSVars = {
                  "--timeline-left": `${leftPct}%`,
                  "--timeline-width": `${Math.max(0.5, widthPct)}%`,
                  "--chapter-color": chapter.color ?? "oklch(0.62 0.18 252)",
                };
                const resizable = Boolean(onChapterResize) && isInteractive;
                return (
                  <div key={chapter.id} className={styles.chapterEntry}>
                    <TimelineButton
                      type="button"
                      data-testid="video-timeline-chapter"
                      data-hovered={hoveredChapterId === chapter.id ? "true" : undefined}
                      title={`${chapter.title} · F${startFrame}-F${endFrame}`}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onSeekChapter?.(chapter.id, startFrame);
                      }}
                      onPointerEnter={() => onHoverChapter?.(chapter.id)}
                      onPointerLeave={() => onHoverChapter?.(null)}
                      className={cn(
                        styles.chapterMarker,
                        isInteractive && styles.interactive,
                        hoveredChapterId === chapter.id && styles.chapterMarkerHovered,
                      )}
                      vars={chapterStyle}
                    />
                    {resizable && (
                      <>
                        <TimelineSpan
                          data-testid="video-chapter-resize-start"
                          data-chapter-resize="start"
                          className={styles.chapterResizeHandle}
                          vars={{ "--timeline-left": `${leftPct}%` }}
                          onPointerDown={(e) => beginChapterResize(e, chapter, "start")}
                          onPointerMove={moveChapterResize}
                          onPointerUp={endChapterResize}
                          onPointerCancel={endChapterResize}
                        />
                        <TimelineSpan
                          data-testid="video-chapter-resize-end"
                          data-chapter-resize="end"
                          className={styles.chapterResizeHandle}
                          vars={{ "--timeline-left": `${rightPct}%` }}
                          onPointerDown={(e) => beginChapterResize(e, chapter, "end")}
                          onPointerMove={moveChapterResize}
                          onPointerUp={endChapterResize}
                          onPointerCancel={endChapterResize}
                        />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {bookmarks.map((bookmark) => (
            <TimelineButton
              key={bookmark.id}
              type="button"
              data-testid="video-bookmark-marker"
              title={bookmark.label ?? `F ${bookmark.frameIndex}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onSeekBookmark?.(bookmark.frameIndex);
              }}
              className={cn(styles.bookmarkMarker, isInteractive && styles.interactive)}
              vars={{ "--timeline-left": frameLeft(bookmark.frameIndex) }}
            />
          ))}
          {issueFrames.map((frame) => (
            <TimelineButton
              key={`issue-${frame}`}
              type="button"
              data-testid="video-issue-marker"
              title={`Issue · F ${frame}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onSeek(frame);
              }}
              className={cn(styles.issueMarker, isInteractive && styles.interactive)}
              vars={{ "--timeline-left": frameLeft(frame) }}
            />
          ))}
          {!selectedTrackTimeline && globalTimelineDensity.length > 0 && (
            <div data-testid="video-timeline-density" className={styles.densityTrack}>
              {globalTimelineDensity.map((bin) => {
                if (bin.density <= 0) return null;
                // 等宽分桶: 每个 bin 占 1/binCount 的等宽切片, 不按帧数比例算宽度
                // —— 否则首末桶因 floor 取整只覆盖 1 帧而显著偏窄, 且与网格刻度 (frameLeft) 的
                //    坐标系不一致 (此前 left 用 /maxFrame、width 用 /(maxFrame+1))。
                const binCount = globalTimelineDensity.length;
                const binStyle: CSSVars = {
                  "--timeline-left": `${(bin.index / binCount) * 100}%`,
                  "--timeline-width": `${(1 / binCount) * 100}%`,
                  "--density-height": `${Math.max(2, (bin.density / densityScaleMax) * DENSITY_BAR_MAX_PX)}px`,
                  "--density-gradient": densityBinGradient(bin, trackColorOverrides),
                };
                return (
                  <TimelineSpan
                    key={bin.index}
                    className={styles.densityBin}
                    vars={binStyle}
                  />
                );
              })}
            </div>
          )}
          {/* v0.21.9 · AI 预测密度轨 (独立 violet lane, 始终显示; 与人工密度条不同层)。 */}
          {predictionDensity.some((bin) => bin.count > 0) && (
            <div data-testid="video-timeline-prediction-density" className={styles.predictionTrack}>
              {predictionDensity.map((bin) => {
                if (bin.count <= 0) return null;
                const binCount = predictionDensity.length;
                const binStyle: CSSVars = {
                  "--timeline-left": `${(bin.index / binCount) * 100}%`,
                  "--timeline-width": `${(1 / binCount) * 100}%`,
                  "--density-height": `${Math.max(2, (bin.count / densityScaleMax) * DENSITY_BAR_MAX_PX)}px`,
                };
                return (
                  <TimelineSpan
                    key={bin.index}
                    className={styles.predictionBin}
                    vars={binStyle}
                  />
                );
              })}
            </div>
          )}
          {selectedTrackTimeline && (
            <TimelineDiv
              data-testid="video-track-timeline"
              className={styles.trackTimeline}
              vars={trackColor ? { "--track-keyframe-color": trackColor } : {}}
            >
              {selectedTrackTimeline.interpolated.map((segment) => (
                <TimelineSpan
                  key={`interpolated-${segment.from}-${segment.to}`}
                  data-testid="video-timeline-interpolated"
                  className={cn(styles.trackSegment, styles.interpolatedSegment, segment.hasPrediction && styles.predictedSegment)}
                  vars={rangeStyle(segment.from, segment.to)}
                />
              ))}
              {selectedTrackTimeline.outside.map((segment) => (
                <TimelineSpan
                  key={`track-outside-${segment.from}-${segment.to}`}
                  data-testid="video-timeline-outside"
                  className={cn(styles.trackSegment, styles.outsideSegment, segment.source === "prediction" && styles.outsidePrediction)}
                  vars={rangeStyle(segment.from, segment.to)}
                />
              ))}
              {selectedTrackTimeline.keyframes.map((keyframe) => (
                <TimelineSpan
                  key={`track-keyframe-${keyframe.frame}`}
                  data-testid="video-timeline-track-keyframe"
                  className={cn(
                    styles.trackKeyframe,
                    keyframe.source === "prediction" && styles.trackKeyframePrediction,
                    keyframe.occluded && styles.trackKeyframeOccluded,
                  )}
                  vars={{ "--timeline-left": frameLeft(keyframe.frame) }}
                />
              ))}
            </TimelineDiv>
          )}
        </div>
        {frameTooltip && (
          <TimelineDiv
            data-testid={hoverPreview ? "video-frame-preview-popover" : "video-frame-tooltip"}
            className={cn(styles.tooltip, hoverPreview ? styles.previewTooltip : styles.frameTooltip)}
            vars={{ "--tooltip-left": hoverPreview ? hoverPopoverLeft : `${hoverLeft}%` }}
          >
            {hoverPreview ? (
              <div className={styles.previewContent}>
                <div
                  data-testid="video-frame-preview-image-shell"
                  className={styles.previewImageShell}
                >
                  {hoverPreview.status === "ready" ? (
                    <img
                      data-testid="video-frame-preview-image"
                      src={hoverPreview.url}
                      alt=""
                      className={styles.previewImage}
                    />
                  ) : hoverPreview.status === "pending" ? (
                    <span>Loading F {hoverPreview.frameIndex}</span>
                  ) : (
                    <span>Preview unavailable</span>
                  )}
                </div>
                <div className={styles.previewMeta}>
                  <span>{frameTooltip}</span>
                  <span className={styles.previewFormat}>
                    {hoverPreview.status === "ready" ? hoverPreview.format.toUpperCase() : hoverPreview.status}
                  </span>
                </div>
              </div>
            ) : frameTooltip}
          </TimelineDiv>
        )}
      </div>

      <div className={cn("mono", styles.status)}>
        <span>F {frameIndex} / {maxFrame}</span>
        <span>{formatTime(frameToTime(frameIndex, timebase))}</span>
        {playbackRateLabel && <span data-testid="video-playback-rate">{playbackRateLabel}</span>}
        {loopRegion && (
          <>
            <span data-testid="video-loop-region-label">Loop {loopRegion.startFrame}-{loopRegion.endFrame}</span>
            <button
              type="button"
              title="清除播放范围 (Alt+L)"
              onClick={onClearLoopRegion}
              className={cn(styles.clearLoopButton, isInteractive && styles.interactive)}
            >
              清除
            </button>
          </>
        )}
        <span>{currentFrameEntryCount} 框</span>
      </div>
    </div>
  );
}
