import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { frameToTime, type FrameTimebase } from "./frameTimebase";
import type { VideoBookmark, VideoLoopRegion } from "./videoNavigationState";
import type { VideoFramePreview } from "./useVideoFramePreview";
import type { VideoTimelineDensityBin, VideoTrackTimeline } from "./videoTrackTimeline";
import styles from "./VideoPlaybackOverlay.module.css";

type HighlightAction = "prev" | "next" | "play" | null;
type CSSVars = Record<`--${string}`, string | number>;

export interface VideoTimelineChapter {
  id: string;
  startFrame: number;
  endFrame: number;
  title: string;
  color?: string | null;
}

interface VideoPlaybackOverlayProps {
  frameIndex: number;
  maxFrame: number;
  /** v0.10.29 · 采样网格步长 (源帧空间)。>1 时在时间轴渲染网格刻度；1 时不画。 */
  samplingStep?: number;
  timebase: FrameTimebase;
  isPlaying: boolean;
  playbackRateLabel?: string;
  selectedTrackTimeline?: VideoTrackTimeline | null;
  globalTimelineDensity?: VideoTimelineDensityBin[];
  loopRegion?: VideoLoopRegion | null;
  bookmarks?: VideoBookmark[];
  chapters?: VideoTimelineChapter[];
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
  timebase,
  isPlaying,
  playbackRateLabel,
  selectedTrackTimeline = null,
  globalTimelineDensity = [],
  loopRegion = null,
  bookmarks = [],
  chapters = [],
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
}: VideoPlaybackOverlayProps) {
  const [hoverFrame, setHoverFrame] = useState<number | null>(null);
  const [loopDraft, setLoopDraft] = useState<VideoLoopRegion | null>(null);
  const loopDraftRef = useRef<VideoLoopRegion | null>(null);
  const seekDragRef = useRef(false);
  const timelineShellRef = useRef<HTMLDivElement | null>(null);
  const hoverFrameRef = useRef<number | null>(null);
  const frameTooltip = useMemo(() => {
    if (hoverFrame === null) return null;
    return `F ${hoverFrame} · ${formatTime(frameToTime(hoverFrame, timebase))}`;
  }, [hoverFrame, timebase]);
  const maxDensity = useMemo(
    () => Math.max(1, ...globalTimelineDensity.map((bin) => bin.density)),
    [globalTimelineDensity],
  );
  // v0.10.29 · 采样网格刻度：step>1 时在时间轴渲染网格帧 tick。
  // 网格点过密时 (>200) 按比例抽稀，避免长视频生成海量 DOM 节点。
  const gridTicks = useMemo(() => {
    if (samplingStep <= 1 || maxFrame <= 0) return [];
    const total = Math.floor(maxFrame / samplingStep) + 1;
    const stride = total > 200 ? Math.ceil(total / 200) : 1;
    const ticks: number[] = [];
    for (let i = 0; i < total; i += stride) {
      ticks.push(Math.min(maxFrame, i * samplingStep));
    }
    return ticks;
  }, [maxFrame, samplingStep]);
  const currentFrameOffGrid = samplingStep > 1 && frameIndex % samplingStep !== 0;
  const frameLeft = (frame: number) => `${maxFrame > 0 ? (frame / maxFrame) * 100 : 0}%`;
  const frameFromPointer = (clientX: number, rect: DOMRect) => {
    const pointerX = Number.isFinite(clientX) ? clientX : rect.left;
    const ratio = rect.width > 0 ? (pointerX - rect.left) / rect.width : 0;
    return Math.max(0, Math.min(maxFrame, Math.round(ratio * maxFrame)));
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
    const left = maxFrame > 0 ? (from / maxFrame) * 100 : 0;
    const right = maxFrame > 0 ? (to / maxFrame) * 100 : 0;
    return {
      "--timeline-left": `${left}%`,
      "--timeline-width": `${Math.max(0.5, right - left)}%`,
    };
  };
  const stepTimelineByKey = (e: ReactKeyboardEvent, target: HTMLElement) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return false;
    e.preventDefault();
    e.stopPropagation();
    const step = e.shiftKey ? 10 : 1;
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
      const step = e.shiftKey ? 10 : 1;
      onSeekByFrames(e.key === "ArrowRight" ? step : -step);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [interactive, onSeekByFrames, visible]);
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
          e.preventDefault();
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          const frame = frameFromPointer(e.clientX, rect);
          focusTimelineShell(e.currentTarget);
          if (!e.shiftKey || !onLoopRegionChange) {
            seekDragRef.current = true;
            onSeek(frame);
            e.currentTarget.setPointerCapture?.(e.pointerId);
            return;
          }
          const next = { startFrame: frame, endFrame: frame };
          loopDraftRef.current = next;
          setLoopDraft(next);
          e.currentTarget.setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const frame = frameFromPointer(e.clientX, rect);
          updateHoverFrame(frame);
          const draft = loopDraftRef.current;
          if (draft) {
            e.preventDefault();
            const next = normalizeLoop(draft.startFrame, frame);
            loopDraftRef.current = next;
            setLoopDraft(next);
            return;
          }
          if (seekDragRef.current) {
            e.preventDefault();
            onSeek(frame);
          }
        }}
        onPointerUp={(e) => {
          const draft = loopDraftRef.current;
          if (draft && onLoopRegionChange) {
            e.preventDefault();
            onLoopRegionChange(draft);
            loopDraftRef.current = null;
            setLoopDraft(null);
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
          if (!loopDraftRef.current && !seekDragRef.current) return;
          seekDragRef.current = false;
          loopDraftRef.current = null;
          setLoopDraft(null);
          e.currentTarget.releasePointerCapture?.(e.pointerId);
        }}
        onPointerLeave={() => {
          if (seekDragRef.current || loopDraftRef.current) return;
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
          {(loopRegion || loopDraft) && (
            <TimelineSpan
              data-testid={loopDraft ? "video-loop-region-preview" : "video-loop-region"}
              className={cn(styles.loopRegion, loopDraft && styles.loopRegionDraft)}
              vars={rangeStyle((loopDraft ?? loopRegion)!.startFrame, (loopDraft ?? loopRegion)!.endFrame)}
            />
          )}
          {chapters.length > 0 && (
            <div
              data-testid="video-timeline-chapters"
              className={styles.chaptersTrack}
            >
              {chapters.map((chapter) => {
                const span = Math.max(0, chapter.endFrame - chapter.startFrame);
                const widthPct = maxFrame > 0 ? ((span + 1) / (maxFrame + 1)) * 100 : 100;
                const leftPct = maxFrame > 0 ? (chapter.startFrame / maxFrame) * 100 : 0;
                const chapterStyle: CSSVars = {
                  "--timeline-left": `${leftPct}%`,
                  "--timeline-width": `${Math.max(0.5, widthPct)}%`,
                  "--chapter-color": chapter.color ?? "oklch(0.62 0.18 252)",
                };
                return (
                  <TimelineButton
                    key={chapter.id}
                    type="button"
                    data-testid="video-timeline-chapter"
                    title={`${chapter.title} · F${chapter.startFrame}-F${chapter.endFrame}`}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onSeekChapter?.(chapter.id, chapter.startFrame);
                    }}
                    className={cn(styles.chapterMarker, isInteractive && styles.interactive)}
                    vars={chapterStyle}
                  />
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
          {!selectedTrackTimeline && globalTimelineDensity.length > 0 && (
            <div data-testid="video-timeline-density" className={styles.densityTrack}>
              {globalTimelineDensity.map((bin) => {
                if (bin.density <= 0) return null;
                const left = maxFrame > 0 ? (bin.from / maxFrame) * 100 : 0;
                const width = maxFrame > 0 ? ((bin.to - bin.from + 1) / (maxFrame + 1)) * 100 : 100;
                const binStyle: CSSVars = {
                  "--timeline-left": `${left}%`,
                  "--timeline-width": `${Math.max(0.7, width)}%`,
                  "--density-height": `${Math.max(3, (bin.density / maxDensity) * 8)}px`,
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
          {selectedTrackTimeline && (
            <div data-testid="video-track-timeline" className={styles.trackTimeline}>
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
            </div>
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
