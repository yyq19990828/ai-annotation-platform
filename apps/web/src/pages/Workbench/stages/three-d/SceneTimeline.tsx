import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";

import type { SceneTimelineFrameSummary } from "@/api/generated";
import { tasksApi } from "@/api/tasks";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useElementStyle } from "@/components/ui/useElementStyle";
import { useSceneTimeline } from "@/hooks/useSceneTimeline";
import { cn } from "@/lib/utils";

import {
  SCENE_TIMELINE_CELL_WIDTH,
  SCENE_TIMELINE_OVERSCAN,
  densityRatio,
  timelineInitialRange,
  timelineQueryRange,
  type TimelineFrameRange,
} from "./sceneTimelineVirtualization";
import { prefetchPointCloudFrameAssets } from "./pointCloudAssetCache";
import { CrossFrameJobCenter } from "./CrossFrameJobCenter";

interface SceneTimelineProps {
  taskId: string | null;
  trackId: string | null;
  prefetchDepthRasters?: boolean;
  prefetchDecimateThreshold?: number;
  selectedAnnotationIds?: string[];
  boxCount?: number;
  readOnly?: boolean;
  onNavigateFrame: (taskId: string, annotationId: string | null) => Promise<boolean>;
}

interface TimelineCellProps {
  item: VirtualItem;
  frameIndex: number;
  summary: SceneTimelineFrameSummary | undefined;
  current: boolean;
  maxDensity: number;
  navigating: boolean;
  onNavigate: (summary: SceneTimelineFrameSummary) => void;
  onPrefetch: (summary: SceneTimelineFrameSummary) => void;
}

function TimelineSizer({
  totalWidth,
  start,
  children,
}: {
  totalWidth: number;
  start: number;
  children: ReactNode;
}) {
  const outerRef = useElementStyle<HTMLDivElement>(
    useMemo(() => ({ "--timeline-total-width": `${totalWidth}px` }) as CSSProperties, [totalWidth]),
  );
  const innerRef = useElementStyle<HTMLDivElement>(
    useMemo(() => ({ "--timeline-start": `${start}px` }) as CSSProperties, [start]),
  );
  return (
    <div
      ref={outerRef}
      className="relative h-16 min-w-full w-[var(--timeline-total-width)]"
      data-testid="scene-timeline-virtual-canvas"
    >
      <div
        ref={innerRef}
        className="absolute left-0 top-0 flex h-16 translate-x-[var(--timeline-start)]"
      >
        {children}
      </div>
    </div>
  );
}

function TimelineCell({
  item,
  frameIndex,
  summary,
  current,
  maxDensity,
  navigating,
  onNavigate,
  onPrefetch,
}: TimelineCellProps) {
  const count = summary?.annotation_count ?? 0;
  const barHeight = Math.round(densityRatio(count, maxDensity) * 22);
  const barRef = useElementStyle<HTMLSpanElement>(
    useMemo(
      () => ({ "--timeline-density-height": `${barHeight}px` }) as CSSProperties,
      [barHeight],
    ),
  );
  const available = summary?.state === "available" && !!summary.task_id;
  const missing = summary?.state === "missing";
  const unavailable = summary?.state === "unavailable";
  const trackMaterialized = !!summary?.selected_track;
  const trackDeclaredPresent = summary?.selected_track_present === true;
  const temporalRole = summary?.selected_track?.temporal_role ?? null;
  const label = summary
    ? `帧 ${frameIndex}，${
        missing ? "缺失" : unavailable ? "不可访问" : `${count} 个 3D 标注`
      }${trackDeclaredPresent ? "，当前对象在存在区间内" : ""}${
        trackMaterialized ? `，${temporalRole ?? "sample"} 成员已物化` : ""
      }`
    : `帧 ${frameIndex}，正在加载`;

  return (
    <button
      type="button"
      data-index={item.index}
      data-testid={`scene-timeline-frame-${frameIndex}`}
      aria-label={label}
      aria-current={current ? "step" : undefined}
      disabled={!available || navigating}
      title={label}
      className={cn(
        "group relative flex h-16 w-10 shrink-0 flex-col items-center border-r border-border bg-background text-2xs tabular-nums text-muted-foreground focus-visible:z-base focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand disabled:cursor-default",
        available && "cursor-pointer hover:bg-muted hover:text-foreground",
        current && "bg-brand/10 text-brand",
        missing && "border-r-dashed bg-muted/50 opacity-60",
        unavailable && "opacity-45",
      )}
      onClick={() => summary && onNavigate(summary)}
      onPointerEnter={() => summary && onPrefetch(summary)}
      onFocus={() => summary && onPrefetch(summary)}
    >
      <span className="mt-1 leading-none">{frameIndex}</span>
      <span className="relative mt-1 h-[30px] w-full" aria-hidden="true">
        {barHeight > 0 && (
          <span
            ref={barRef}
            className={cn(
              "absolute bottom-0 left-1/2 w-1.5 -translate-x-1/2 rounded-t-sm bg-muted-foreground/45 h-[var(--timeline-density-height)]",
              current && "bg-brand",
            )}
          />
        )}
      </span>
      <span
        data-testid={trackDeclaredPresent ? `scene-timeline-track-frame-${frameIndex}` : undefined}
        className={cn(
          "relative mb-1 block h-1 w-5 rounded-full bg-transparent",
          trackDeclaredPresent && "bg-brand/30",
        )}
        aria-hidden="true"
      >
        {trackMaterialized && (
          <span
            className={cn(
              "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
              temporalRole === "keyframe" && "size-2 rounded-full bg-brand",
              temporalRole === "derived" && "h-1 w-3 rounded-full bg-violet-500",
              temporalRole === "sample" && "size-1.5 rotate-45 bg-muted-foreground",
            )}
          />
        )}
      </span>
    </button>
  );
}

export function SceneTimeline({
  taskId,
  trackId,
  prefetchDepthRasters = false,
  prefetchDecimateThreshold,
  selectedAnnotationIds = [],
  boxCount = 0,
  readOnly = false,
  onNavigateFrame,
}: SceneTimelineProps) {
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [range, setRange] = useState<TimelineFrameRange>(timelineInitialRange);
  const [navigatingTaskId, setNavigatingTaskId] = useState<string | null>(null);
  const [jobCenterOpen, setJobCenterOpen] = useState(false);
  const query = useSceneTimeline(taskId, range.startFrame, range.endFrame, trackId);
  const data = query.data;
  const sceneStart = data?.scene_start_frame ?? 0;
  const sceneEnd = data?.scene_end_frame ?? -1;
  const currentFrame = data?.current_frame_index ?? null;
  const frameCount = sceneEnd >= sceneStart ? sceneEnd - sceneStart + 1 : 0;
  const virtualizer = useVirtualizer({
    horizontal: true,
    count: frameCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => SCENE_TIMELINE_CELL_WIDTH,
    overscan: SCENE_TIMELINE_OVERSCAN,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const firstVirtualIndex = virtualItems[0]?.index ?? 0;
  const lastVirtualIndex = virtualItems[virtualItems.length - 1]?.index ?? 0;

  useEffect(() => {
    setRange(timelineInitialRange());
  }, [taskId]);

  useEffect(() => {
    if (frameCount <= 1 || virtualItems.length === 0) return;
    const next = timelineQueryRange({
      sceneStart,
      sceneEnd,
      firstVirtualIndex,
      lastVirtualIndex,
    });
    setRange((previous) =>
      previous.startFrame === next.startFrame && previous.endFrame === next.endFrame
        ? previous
        : next,
    );
  }, [firstVirtualIndex, frameCount, lastVirtualIndex, sceneEnd, sceneStart, virtualItems.length]);

  useEffect(() => {
    if (collapsed || currentFrame == null || frameCount <= 1) return;
    const targetIndex = currentFrame - sceneStart;
    if (targetIndex < 0 || targetIndex >= frameCount) return;
    const frame = window.requestAnimationFrame(() => {
      virtualizer.scrollToIndex(targetIndex, { align: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [collapsed, currentFrame, frameCount, sceneStart, virtualizer]);

  const frameByIndex = useMemo(
    () => new Map((data?.frames ?? []).map((frame) => [frame.frame_index, frame])),
    [data?.frames],
  );
  const maxDensity = Math.max(
    1,
    ...(data?.frames ?? []).map((frame) => frame.annotation_count ?? 0),
  );

  const prefetchFrame = useCallback(
    (summary: SceneTimelineFrameSummary) => {
      if (summary.state !== "available" || !summary.task_id || summary.task_id === taskId) {
        return Promise.resolve();
      }
      return queryClient
        .fetchQuery({
          queryKey: ["task-point-cloud-manifest", summary.task_id],
          queryFn: () => tasksApi.getPointCloudManifest(summary.task_id!),
          staleTime: 5 * 60 * 1000,
        })
        .then((manifest) =>
          prefetchPointCloudFrameAssets(manifest, {
            depthRasters: prefetchDepthRasters,
            ...(prefetchDecimateThreshold === undefined
              ? {}
              : { decimateThreshold: prefetchDecimateThreshold }),
          }),
        )
        .catch(() => {});
    },
    [prefetchDecimateThreshold, prefetchDepthRasters, queryClient, taskId],
  );

  useEffect(() => {
    if (!data || currentFrame == null) return;
    const frames = data.frames ?? [];
    const next = frames.find((frame) => frame.frame_index === currentFrame + 1);
    if (next) void prefetchFrame(next);
  }, [currentFrame, data, prefetchFrame]);

  const handleNavigate = async (summary: SceneTimelineFrameSummary) => {
    if (!summary.task_id || summary.task_id === taskId) return;
    setNavigatingTaskId(summary.task_id);
    try {
      await prefetchFrame(summary);
      const allowed = await onNavigateFrame(
        summary.task_id,
        summary.selected_track?.annotation_id ?? null,
      );
      if (allowed) {
        const following = frameByIndex.get(summary.frame_index + 1);
        if (following) void prefetchFrame(following);
      }
    } finally {
      setNavigatingTaskId(null);
    }
  };

  if (query.isError && !data?.scene_id) {
    return (
      <div className="flex h-8 shrink-0 items-center justify-between border-t border-border bg-card px-3 text-xs text-status-danger">
        <span>Scene 时间轴加载失败</span>
        <Button size="xs" variant="ghost" onClick={() => void query.refetch()}>
          重试
        </Button>
      </div>
    );
  }
  if (!taskId || !data?.scene_id || currentFrame == null || frameCount <= 1) return null;

  return (
    <section
      className="shrink-0 border-t border-border bg-card"
      aria-label="3D Scene 时间轴"
      data-testid="three-d-scene-timeline"
    >
      <header className="flex h-8 items-center gap-2 border-b border-border px-2.5 text-xs">
        <Button
          size="xs"
          variant="ghost"
          className="size-6 p-0"
          aria-label={collapsed ? "展开 Scene 时间轴" : "收起 Scene 时间轴"}
          aria-expanded={!collapsed}
          data-testid="scene-timeline-toggle"
          onClick={() => setCollapsed((value) => !value)}
        >
          <Icon name={collapsed ? "chevUp" : "chevDown"} />
        </Button>
        <span className="truncate font-medium text-foreground" title={data.scene_name ?? "Scene"}>
          {data.scene_name ?? "Scene"}
        </span>
        <span className="tabular-nums text-muted-foreground">
          F{currentFrame} / F{sceneEnd}
        </span>
        {trackId && <span className="text-brand">当前对象轨迹</span>}
        <Button
          size="xs"
          variant="ghost"
          className="ml-auto"
          data-testid="scene-cross-frame-job-center"
          onClick={() => setJobCenterOpen(true)}
        >
          跨帧任务
        </Button>
        <span className="tabular-nums text-muted-foreground">
          {data.populated_frame_count ?? 0} 帧{query.isFetching ? " · 更新中" : ""}
        </span>
      </header>
      {!collapsed && (
        <div
          ref={scrollRef}
          className="overflow-x-auto overflow-y-hidden"
          aria-label="Scene 帧列表"
        >
          <TimelineSizer
            totalWidth={virtualizer.getTotalSize()}
            start={virtualItems[0]?.start ?? 0}
          >
            {virtualItems.map((item) => {
              const frameIndex = sceneStart + item.index;
              const summary = frameByIndex.get(frameIndex);
              return (
                <TimelineCell
                  key={item.key}
                  item={item}
                  frameIndex={frameIndex}
                  summary={summary}
                  current={frameIndex === currentFrame}
                  maxDensity={maxDensity}
                  navigating={navigatingTaskId === summary?.task_id}
                  onNavigate={(frame) => void handleNavigate(frame)}
                  onPrefetch={prefetchFrame}
                />
              );
            })}
          </TimelineSizer>
        </div>
      )}
      <CrossFrameJobCenter
        open={jobCenterOpen}
        onClose={() => setJobCenterOpen(false)}
        taskId={taskId}
        currentFrame={currentFrame}
        sceneStartFrame={sceneStart}
        sceneEndFrame={sceneEnd}
        selectedAnnotationIds={selectedAnnotationIds}
        selectedTrackId={trackId}
        boxCount={boxCount}
        readOnly={readOnly}
      />
    </section>
  );
}
