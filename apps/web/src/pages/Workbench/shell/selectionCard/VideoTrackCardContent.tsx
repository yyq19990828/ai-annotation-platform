import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DropdownMenu, type DropdownItem } from "@/components/ui/DropdownMenu";
import { Icon } from "@/components/ui/Icon";
import { useToastStore } from "@/components/ui/Toast";
import type { AttributeSchema } from "@/api/projects";
import type { Geometry } from "@/types";
import type { VideoTrackerJobState } from "@/hooks/useVideoTrackerJobs";
import { getTrackColor } from "../../stage/colors";
import { resolveTrackAtFrame, shortTrackId, sortedKeyframes } from "../../stage/videoStageGeometry";
import { isFrameOutside } from "../../stage/videoTrackOutside";
import { nextKeyframeFrame, prevKeyframeFrame } from "../../stage/videoTrackTimeline";
import {
  frameRange,
  keyframeStatus,
  nextPredictionFrame,
  sourceChipText,
} from "../../stage/videoTrackFormat";
import { VideoAttributesEditor } from "../../stage/VideoAttributesEditor";
import { VideoTrackerJobBadge } from "../../stage/VideoTrackerJobBadge";
import {
  VideoKeyframesPropagateDialog,
  type VideoKeyframesPropagateSubmit,
} from "../../stage/VideoKeyframesPropagateDialog";
import type { TrackMarkPatch } from "../../stage/useVideoTrackActions";
import type {
  VideoTrackAnnotation,
  VideoTrackConversionOptions,
  VideoTrackGhost,
} from "../../stage/videoStageTypes";
import { IdentityHeader } from "./IdentityHeader";
import { MetricGrid } from "./MetricGrid";
import { MetaFooter } from "./MetaFooter";
import { ActionBar } from "./ActionBar";
import { geometryMetrics, type Metric } from "./geometryMetrics";
import cardStyles from "./cardLayout.module.css";
import styles from "./VideoTrackCardContent.module.css";

export interface VideoTrackCardContentProps {
  selectedTrack: VideoTrackAnnotation;
  selectedTrackGhost: VideoTrackGhost | null;
  selectedTrackLocked: boolean;
  currentFrameOutside: boolean;
  frameIndex: number;
  fps: number | null;
  imageWidth: number | null;
  imageHeight: number | null;
  userId?: string | null;
  readOnly: boolean;
  attributeSchema?: AttributeSchema;
  /** 逐轨道颜色覆盖(session 级),用于色块与列表/画布同源。 */
  trackColorOverrides?: Record<string, string>;
  /** 选中轨迹当前是否隐藏(底部操作栏的显隐切换态)。 */
  selectedTrackHidden: boolean;
  copiedKeyframeLabel?: string | null;
  canCopyCurrentKeyframe: boolean;
  canPasteKeyframe: boolean;
  trackerJob?: VideoTrackerJobState;
  samplingStep?: number;
  propagateOverwrite?: boolean | null;
  onSeekFrame?: (frameIndex: number) => void;
  onToggleHidden: () => void;
  onToggleLock: () => void;
  onChangeClass?: (anchor: { left: number; top: number }) => void;
  onDeleteTrack?: () => void;
  onSplitSelectedTrack?: () => void;
  onPropagateTrack?: (annotation: VideoTrackAnnotation) => void;
  onMarkSelectedTrack: (patch: TrackMarkPatch) => void;
  onCopySelectedTrackToCurrentFrame: () => void;
  onCopyCurrentKeyframe: () => void;
  onPasteKeyframeToCurrentFrame: () => void;
  onDeleteTrackKeyframe: (annotation: VideoTrackAnnotation, targetFrame: number) => void;
  onConvertToBboxes?: (annotation: VideoTrackAnnotation, options: VideoTrackConversionOptions) => void;
  onCancelTrackerJob?: (jobId: string) => void;
  onAcceptPredictionKeyframe?: (annotation: VideoTrackAnnotation, frameIndex: number) => void;
  onRejectPredictionKeyframe?: (annotation: VideoTrackAnnotation, frameIndex: number) => void;
  onUpdateTrackAttributes?: (annotation: VideoTrackAnnotation, attributes: Record<string, unknown>) => void;
  onUpdateKeyframeAttributes?: (annotation: VideoTrackAnnotation, frameIndex: number, attributes: Record<string, unknown>) => void;
  onPropagateKeyframe?: (
    annotation: VideoTrackAnnotation,
    fromFrame: number,
    count: number,
    options: { direction: "forward" | "backward"; overwrite: boolean },
  ) => void;
  onUpdateSemanticLabel?: (annotation: VideoTrackAnnotation, semanticLabel: string) => void;
}

function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

/** 秒 → 紧凑时间码 m:ss(帧定位 chip 用,不带毫秒)。 */
function formatTimecode(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * 选中视频「轨迹」(video_track)的浮动卡内容。
 *
 * 取代「把整个右栏轨迹面板(含全部轨迹清单)搬进卡」的旧做法,聚焦单条选中轨迹,
 * 用选中卡设计系统(IdentityHeader / MetricGrid / MetaFooter)承载两层语义:
 * 「轨迹整体」(关键帧数 / 范围 / 语义标签 / 轨迹操作 / 轨迹属性)+「当前帧」
 * (帧定位 / 状态来源 / 几何指标 / 帧操作 / 帧属性),并整合关键帧表 + 上/下关键帧导航
 * (退役画布右上的旧快跳浮层)。轨迹清单与多选批量留在右栏 roster。
 */
export function VideoTrackCardContent({
  selectedTrack,
  selectedTrackGhost,
  selectedTrackLocked,
  currentFrameOutside,
  frameIndex,
  fps,
  imageWidth,
  imageHeight,
  userId,
  readOnly,
  attributeSchema,
  trackColorOverrides,
  selectedTrackHidden,
  copiedKeyframeLabel,
  canCopyCurrentKeyframe,
  canPasteKeyframe,
  trackerJob,
  samplingStep,
  propagateOverwrite,
  onSeekFrame,
  onToggleHidden,
  onToggleLock,
  onChangeClass,
  onDeleteTrack,
  onSplitSelectedTrack,
  onPropagateTrack,
  onMarkSelectedTrack,
  onCopySelectedTrackToCurrentFrame,
  onCopyCurrentKeyframe,
  onPasteKeyframeToCurrentFrame,
  onDeleteTrackKeyframe,
  onConvertToBboxes,
  onCancelTrackerJob,
  onAcceptPredictionKeyframe,
  onRejectPredictionKeyframe,
  onUpdateTrackAttributes,
  onUpdateKeyframeAttributes,
  onPropagateKeyframe,
  onUpdateSemanticLabel,
}: VideoTrackCardContentProps) {
  const geom = selectedTrack.geometry;
  const pushToast = useToastStore((s) => s.push);
  const trackColor = getTrackColor(geom.track_id, selectedTrack.class_name, trackColorOverrides);
  const [propagateOpen, setPropagateOpen] = useState(false);
  const copyTrackId = () => {
    if (!navigator.clipboard?.writeText) {
      pushToast({ msg: "当前环境不支持复制(需 HTTPS 或 localhost)", kind: "warning" });
      return;
    }
    void navigator.clipboard.writeText(geom.track_id);
    pushToast({ msg: `已复制轨迹 ID ${shortTrackId(geom.track_id)}`, kind: "success" });
  };
  // semantic_label inline 编辑草稿; null 表示同步当前轨迹值。切换轨迹时重置。
  const [semanticDraft, setSemanticDraft] = useState<string | null>(null);
  useEffect(() => {
    setSemanticDraft(null);
  }, [selectedTrack.id]);

  const resolved = resolveTrackAtFrame(geom, frameIndex);
  const currentKeyframe = geom.keyframes.find((kf) => kf.frame_index === frameIndex) ?? null;
  const currentFrameHasKeyframe = resolved !== null;
  const frameStatusText = currentFrameOutside
    ? "消失"
    : currentKeyframe?.occluded
      ? "遮挡"
      : currentKeyframe
        ? "关键帧"
        : "非关键帧";
  const occluded = !currentFrameOutside && Boolean(currentKeyframe?.occluded);

  const trackMetrics: Metric[] = [
    { label: "关键帧数", value: `${geom.keyframes.length}` },
    { label: "范围", value: frameRange(geom.keyframes.map((kf) => kf.frame_index)) },
  ];
  const currentMetrics: Metric[] = [
    { label: "状态", value: frameStatusText },
    { label: "来源", value: sourceChipText(resolved?.source ?? null) },
    ...(resolved
      ? geometryMetrics(
          { type: "bbox", x: resolved.geom.x, y: resolved.geom.y, w: resolved.geom.w, h: resolved.geom.h } as Geometry,
          imageWidth,
          imageHeight,
        )
      : []),
  ];

  const nextPrediction = nextPredictionFrame(geom, frameIndex);
  const prevKf = prevKeyframeFrame(geom, frameIndex);
  const nextKf = nextKeyframeFrame(geom, frameIndex);
  const canPropagate = Boolean(
    !readOnly && !selectedTrackLocked && onPropagateKeyframe && currentFrameHasKeyframe,
  );

  const semanticValue = semanticDraft ?? geom.semantic_label ?? "";
  const commitSemanticLabel = () => {
    if (semanticDraft === null) return;
    const next = semanticDraft.trim();
    if (next === (geom.semantic_label ?? "")) {
      setSemanticDraft(null);
      return;
    }
    onUpdateSemanticLabel?.(selectedTrack, next);
    setSemanticDraft(null);
  };

  const timeLabel = fps ? formatTimecode(frameIndex / fps) : null;
  const frameChip = (
    <span
      className={cn(styles.frameChip, currentFrameOutside && styles.frameChipDanger)}
      title={`当前第 ${frameIndex} 帧`}
    >
      <Icon name="film" size={10} />F{frameIndex}
      {timeLabel && <span> · {timeLabel}</span>}
    </span>
  );

  const convertTrackMenuItems = useMemo<DropdownItem[]>(() => {
    const disabled = readOnly || !onConvertToBboxes;
    return [
      {
        id: "copy-keyframes",
        label: "复制关键帧",
        icon: "box",
        disabled,
        onSelect: () => onConvertToBboxes?.(selectedTrack, { operation: "copy", scope: "track", frameMode: "keyframes" }),
      },
      {
        id: "copy-all-frames",
        label: "复制全帧",
        icon: "film",
        disabled,
        onSelect: () => onConvertToBboxes?.(selectedTrack, { operation: "copy", scope: "track", frameMode: "all_frames" }),
      },
      { id: "convert-divider", divider: true, label: "" },
      {
        id: "split-keyframes",
        label: "拆关键帧",
        icon: "scissors",
        disabled,
        onSelect: () => onConvertToBboxes?.(selectedTrack, { operation: "split", scope: "track", frameMode: "keyframes" }),
      },
      {
        id: "split-all-frames",
        label: "拆全帧",
        icon: "film",
        disabled,
        onSelect: () => onConvertToBboxes?.(selectedTrack, { operation: "split", scope: "track", frameMode: "all_frames" }),
      },
    ];
  }, [onConvertToBboxes, readOnly, selectedTrack]);

  const hasAttributes = Boolean(attributeSchema && (onUpdateTrackAttributes || onUpdateKeyframeAttributes));

  return (
    <div className={cardStyles.body}>
      <IdentityHeader
        className={selectedTrack.class_name}
        source={selectedTrack.source === "prediction_based" ? "accepted" : "manual"}
        dotColor={trackColor}
      />

      {/* —— 轨迹整体 —— */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>轨迹整体</span>
          <div className={styles.headerActions}>
            <span className={cn("mono", styles.sectionCount)}>{shortTrackId(geom.track_id)}</span>
            <Button
              size="sm"
              className={styles.iconButton}
              title="复制轨迹 ID"
              aria-label="复制轨迹 ID"
              onClick={copyTrackId}
            >
              <Icon name="copy" size={13} />
            </Button>
            <DropdownMenu
              items={convertTrackMenuItems}
              minWidth={168}
              zIndex={60}
              trigger={({ open, toggle, ref }) => (
                <Button
                  ref={ref}
                  type="button"
                  size="sm"
                  className={styles.iconButton}
                  disabled={readOnly || !onConvertToBboxes}
                  title="转换为独立框"
                  aria-label="转换为独立框"
                  aria-expanded={open}
                  onClick={toggle}
                >
                  <Icon name="more" size={14} />
                </Button>
              )}
            />
          </div>
        </div>

        <MetricGrid metrics={trackMetrics} />

        {onUpdateSemanticLabel && (
          <label className={styles.semanticRow}>
            <span className={styles.semanticLabel}>语义标签</span>
            <input
              type="text"
              data-testid="video-track-semantic-label-input"
              className={styles.semanticInput}
              placeholder="如 car_3 (跨任务 Re-ID)"
              value={semanticValue}
              disabled={readOnly || selectedTrackLocked}
              onChange={(e) => setSemanticDraft(e.target.value)}
              onBlur={commitSemanticLabel}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setSemanticDraft(null);
              }}
            />
          </label>
        )}

        {trackerJob && (
          <div data-testid="video-tracker-job-row" className={styles.trackerJobRow}>
            <VideoTrackerJobBadge job={trackerJob} onCancel={onCancelTrackerJob} />
          </div>
        )}

        <div className={styles.actionGrid}>
          <Button
            size="sm"
            className={styles.actionButton}
            disabled={readOnly || selectedTrackLocked || !onSplitSelectedTrack}
            title="在当前帧之后拆出后段轨迹"
            onClick={onSplitSelectedTrack}
          >
            <Icon name="scissors" size={13} />拆轨迹
          </Button>
          <Button
            size="sm"
            className={styles.actionButton}
            disabled={nextPrediction === null || !onSeekFrame}
            title="跳转到下一条 prediction 关键帧"
            onClick={() => {
              if (nextPrediction !== null) onSeekFrame?.(nextPrediction);
            }}
          >
            <Icon name="arrowRight" size={13} />下一预测
          </Button>
          <Button
            size="sm"
            className={styles.actionButton}
            disabled={readOnly || selectedTrackLocked || !onPropagateTrack}
            title="发起 AI 传播 (Shift+T)"
            onClick={() => onPropagateTrack?.(selectedTrack)}
          >
            <Icon name="bot" size={13} />AI 传播
          </Button>
          <Button
            size="sm"
            className={styles.actionButton}
            disabled={!canPropagate}
            title="把当前帧的框复制到后续/向前 N 帧"
            onClick={() => setPropagateOpen(true)}
          >
            <Icon name="layers" size={13} />复制后续
          </Button>
        </div>
      </div>

      {/* —— 当前帧 —— */}
      <div className={cn(styles.section, styles.sectionDivided)}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>当前帧</span>
          {frameChip}
        </div>

        <MetricGrid metrics={currentMetrics} />

        <div className={styles.actionGrid}>
          <Button
            size="sm"
            className={styles.actionButton}
            disabled={!selectedTrackGhost || readOnly || selectedTrackLocked}
            title="使用最近关键帧的框在当前帧创建关键帧"
            onClick={onCopySelectedTrackToCurrentFrame}
          >
            <Icon name="plus" size={14} />复制到当前帧
          </Button>
          <Button
            size="sm"
            className={styles.actionButton}
            disabled={!canCopyCurrentKeyframe}
            title="复制当前轨迹在当前帧的关键帧"
            onClick={onCopyCurrentKeyframe}
          >
            <Icon name="copy" size={14} />复制关键帧
          </Button>
          <Button
            size="sm"
            className={styles.actionButton}
            disabled={!canPasteKeyframe}
            title={copiedKeyframeLabel ? `把已复制的 ${copiedKeyframeLabel} 粘贴到当前帧` : "把已复制的关键帧粘贴到当前帧"}
            onClick={onPasteKeyframeToCurrentFrame}
          >
            <Icon name="clipboardPaste" size={14} />粘贴关键帧
          </Button>
          <Button
            size="sm"
            className={styles.actionButton}
            disabled={readOnly || selectedTrackLocked}
            aria-pressed={currentFrameOutside}
            title={currentFrameOutside ? "恢复当前帧为正常状态" : "标记当前帧消失"}
            onClick={() => onMarkSelectedTrack(currentFrameOutside ? { outside: false, occluded: false } : { outside: true, occluded: false })}
          >
            <Icon name="eyeOff" size={14} />标记消失
          </Button>
          <Button
            size="sm"
            className={styles.actionButton}
            disabled={readOnly || selectedTrackLocked}
            aria-pressed={occluded}
            title={occluded ? "恢复当前帧为正常状态" : "标记当前帧遮挡"}
            onClick={() => onMarkSelectedTrack(occluded ? { outside: false, occluded: false } : { outside: false, occluded: true })}
          >
            <Icon name="rect" size={14} />标记遮挡
          </Button>
        </div>
      </div>

      {/* —— 关键帧(整合旧快跳浮层) —— */}
      <div className={cn(styles.section, styles.sectionDivided)}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>关键帧</span>
          <span className={cn("mono", styles.sectionCount)}>{geom.keyframes.length}</span>
        </div>
        <div className={styles.kfNav}>
          <Button
            size="sm"
            className={styles.kfNavButton}
            disabled={prevKf === null || !onSeekFrame}
            title="上一关键帧"
            onClick={() => prevKf !== null && onSeekFrame?.(prevKf)}
          >
            <Icon name="chevLeft" size={14} />上一关键帧
          </Button>
          <Button
            size="sm"
            className={styles.kfNavButton}
            disabled={nextKf === null || !onSeekFrame}
            title="下一关键帧"
            onClick={() => nextKf !== null && onSeekFrame?.(nextKf)}
          >
            下一关键帧<Icon name="chevRight" size={14} />
          </Button>
        </div>
        <div className={styles.keyframeTable}>
          <div className={styles.keyframeHeader}>
            <span>帧</span>
            <span>状态</span>
            <span>操作</span>
          </div>
          {sortedKeyframes(geom).map((kf) => {
            const kfOutside = isFrameOutside(geom, kf.frame_index);
            return (
              <div
                key={kf.frame_index}
                data-testid={kf.source === "prediction" ? "video-prediction-keyframe-row" : "video-track-keyframe-row"}
                className={cn(styles.keyframeRow, kf.source === "prediction" && styles.keyframePredictionRow)}
              >
                <span className={cn("mono", styles.keyframeFrame)}>F{kf.frame_index}</span>
                <span className={cn(styles.keyframeStatus, kfOutside && styles.keyframeStatusAbsent)}>
                  <svg className={styles.keyframeStatusDot} aria-hidden="true" viewBox="0 0 7 7">
                    <circle
                      cx="3.5"
                      cy="3.5"
                      r="3.5"
                      fill={kfOutside ? "var(--color-danger)" : kf.source === "prediction" ? "oklch(0.78 0.14 78)" : "oklch(0.68 0.16 145)"}
                    />
                  </svg>
                  {keyframeStatus(kf, kfOutside)}
                  {kf.source === "prediction" && (
                    <span className={styles.compactBadge}>
                      <Badge variant="default">预测</Badge>
                    </span>
                  )}
                </span>
                <span className={styles.keyframeActionRow}>
                  <Button
                    size="sm"
                    className={styles.keyframeButton}
                    disabled={!onSeekFrame}
                    title="跳转到关键帧"
                    aria-label="跳转到关键帧"
                    onClick={() => onSeekFrame?.(kf.frame_index)}
                  >
                    <Icon name="arrowRight" size={13} />
                  </Button>
                  {kf.source === "prediction" && onAcceptPredictionKeyframe && (
                    <Button
                      size="sm"
                      className={cn(styles.keyframeButton, styles.successButton)}
                      disabled={readOnly}
                      title="接受预测：source 改为 manual"
                      aria-label="接受预测"
                      onClick={() => onAcceptPredictionKeyframe(selectedTrack, kf.frame_index)}
                    >
                      <Icon name="check" size={13} />
                    </Button>
                  )}
                  {kf.source === "prediction" && onRejectPredictionKeyframe && (
                    <Button
                      size="sm"
                      className={cn(styles.keyframeButton, styles.dangerButton)}
                      disabled={readOnly}
                      title="拒绝预测：把该帧并入 outside"
                      aria-label="拒绝预测"
                      onClick={() => onRejectPredictionKeyframe(selectedTrack, kf.frame_index)}
                    >
                      <Icon name="x" size={13} />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    className={styles.keyframeButton}
                    disabled={readOnly || kfOutside}
                    title="复制此关键帧为独立框"
                    aria-label="复制此关键帧为独立框"
                    onClick={() => onConvertToBboxes?.(selectedTrack, { operation: "copy", scope: "frame", frameIndex: kf.frame_index })}
                  >
                    <Icon name="box" size={13} />
                  </Button>
                  <Button
                    size="sm"
                    className={styles.keyframeButton}
                    disabled={readOnly || kfOutside}
                    title="拆此关键帧为独立框"
                    aria-label="拆此关键帧为独立框"
                    onClick={() => onConvertToBboxes?.(selectedTrack, { operation: "split", scope: "frame", frameIndex: kf.frame_index })}
                  >
                    <Icon name="scissors" size={13} />
                  </Button>
                  <Button
                    size="sm"
                    className={cn(styles.keyframeButton, styles.dangerButton)}
                    disabled={readOnly || geom.keyframes.length <= 1}
                    title="删除关键帧"
                    aria-label="删除关键帧"
                    onClick={() => onDeleteTrackKeyframe(selectedTrack, kf.frame_index)}
                  >
                    <Icon name="trash" size={13} />
                  </Button>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* —— 属性(轨迹级 + 当前帧级) —— */}
      {hasAttributes && (
        <div className={cn(styles.section, styles.sectionDivided)} data-floating-panel-no-drag>
          <VideoAttributesEditor
            schema={attributeSchema}
            className={selectedTrack.class_name}
            trackAttributes={selectedTrack.attributes}
            keyframeAttributes={
              (geom.keyframes.find((kf) => kf.frame_index === frameIndex) as
                | { attributes?: Record<string, unknown> | null }
                | undefined)?.attributes ?? undefined
            }
            frameIndex={frameIndex}
            canEditKeyframe={currentFrameHasKeyframe}
            readOnly={readOnly || selectedTrackLocked}
            onChangeTrackAttributes={(attrs) => onUpdateTrackAttributes?.(selectedTrack, attrs)}
            onChangeKeyframeAttributes={(attrs) => onUpdateKeyframeAttributes?.(selectedTrack, frameIndex, attrs)}
          />
        </div>
      )}

      <MetaFooter
        id={selectedTrack.id}
        source={selectedTrack.source}
        createdAt={selectedTrack.created_at}
        updatedAt={selectedTrack.updated_at}
      />

      <ActionBar label="轨迹操作">
        <Button
          variant="ghost"
          size="sm"
          title={selectedTrackHidden ? "显示轨迹" : "隐藏轨迹"}
          aria-label={selectedTrackHidden ? "显示轨迹" : "隐藏轨迹"}
          aria-pressed={selectedTrackHidden}
          onClick={onToggleHidden}
        >
          <Icon name={selectedTrackHidden ? "eyeOff" : "eye"} size={14} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          title={selectedTrackLocked ? "解锁轨迹" : "锁定轨迹"}
          aria-label={selectedTrackLocked ? "解锁轨迹" : "锁定轨迹"}
          aria-pressed={selectedTrackLocked}
          onClick={onToggleLock}
        >
          <Icon name={selectedTrackLocked ? "lock" : "unlock"} size={14} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          title="修改类别"
          aria-label="修改类别"
          disabled={readOnly || !onChangeClass}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            onChangeClass?.({ left: rect.left, top: rect.bottom + 6 });
          }}
        >
          <Icon name="tag" size={14} />
        </Button>
        <Button
          variant="danger"
          size="sm"
          title="删除整条轨迹"
          aria-label="删除整条轨迹"
          disabled={readOnly || selectedTrackLocked || !onDeleteTrack}
          onClick={onDeleteTrack}
        >
          <Icon name="trash" size={14} />
        </Button>
      </ActionBar>

      <VideoKeyframesPropagateDialog
        open={propagateOpen}
        frameIndex={frameIndex}
        userId={userId}
        samplingStep={samplingStep}
        overwriteOverride={propagateOverwrite}
        onCancel={() => setPropagateOpen(false)}
        onSubmit={(payload: VideoKeyframesPropagateSubmit) => {
          setPropagateOpen(false);
          onPropagateKeyframe?.(selectedTrack, frameIndex, payload.count, {
            direction: payload.direction,
            overwrite: payload.overwrite,
          });
        }}
      />
    </div>
  );
}
