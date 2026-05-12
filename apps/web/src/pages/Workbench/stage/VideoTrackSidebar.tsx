import { useCallback, useEffect, useMemo, useState } from "react";
import type { AnnotationResponse, VideoTrackKeyframe } from "@/types";
import {
  isVideoBbox,
  isVideoTrack,
  nearestTrackBbox,
  nearestTrackKeyframe,
  resolveTrackAtFrame,
  shortTrackId,
  sortedKeyframes,
  upsertKeyframe,
} from "./videoStageGeometry";
import { addOutsideRange, isFrameOutside, removeOutsideFrame } from "./videoTrackOutside";
import { VideoTrackPanel } from "./VideoTrackPanel";
import type {
  VideoFrameEntry,
  VideoTrackAnnotation,
  VideoTrackConversionOptions,
  VideoTrackGhost,
} from "./videoStageTypes";

interface VideoTrackSidebarProps {
  annotations: AnnotationResponse[];
  selectedId: string | null;
  frameIndex: number;
  readOnly: boolean;
  hiddenTrackIds: Set<string>;
  lockedTrackIds: Set<string>;
  classes?: string[];
  onSelect: (id: string | null) => void;
  onToggleHiddenTrack: (trackId: string) => void;
  onToggleLockedTrack: (trackId: string) => void;
  onSeekFrame?: (frameIndex: number) => void;
  onChangeUserBoxClass?: (id: string) => void;
  onRenameTracks?: (annotations: AnnotationResponse[], className: string) => void;
  onDeleteTracks?: (annotations: AnnotationResponse[]) => void;
  onUpdate: (annotation: AnnotationResponse, geometry: VideoTrackAnnotation["geometry"]) => void;
  onConvertToBboxes?: (annotation: AnnotationResponse, options: VideoTrackConversionOptions) => void;
}

interface CopiedKeyframe {
  trackId: string;
  className: string;
  frameIndex: number;
  keyframe: VideoTrackKeyframe;
}

function cloneKeyframe(keyframe: VideoTrackKeyframe): VideoTrackKeyframe {
  return {
    ...keyframe,
    bbox: { ...keyframe.bbox },
  };
}

function sameStringSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

export function VideoTrackSidebar({
  annotations,
  selectedId,
  frameIndex,
  readOnly,
  hiddenTrackIds,
  lockedTrackIds,
  classes,
  onSelect,
  onToggleHiddenTrack,
  onToggleLockedTrack,
  onSeekFrame,
  onChangeUserBoxClass,
  onRenameTracks,
  onDeleteTracks,
  onUpdate,
  onConvertToBboxes,
}: VideoTrackSidebarProps) {
  const videoTracks = useMemo(() => annotations.filter(isVideoTrack), [annotations]);
  const selectedTrack = useMemo(
    () => videoTracks.find((ann) => ann.id === selectedId) ?? null,
    [selectedId, videoTracks],
  );
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(() => new Set());
  const [copiedKeyframe, setCopiedKeyframe] = useState<CopiedKeyframe | null>(null);

  useEffect(() => {
    setSelectedTrackIds((prev) => {
      const availableIds = new Set(videoTracks.map((ann) => ann.id));
      const next = new Set([...prev].filter((id) => availableIds.has(id)));
      if (selectedTrack) {
        if (!next.has(selectedTrack.id)) {
          next.clear();
          next.add(selectedTrack.id);
        }
      } else if (!selectedId || !availableIds.has(selectedId)) {
        next.clear();
      }
      return sameStringSet(prev, next) ? prev : next;
    });
  }, [selectedId, selectedTrack, videoTracks]);

  const selectedTracks = useMemo(
    () => videoTracks.filter((ann) => selectedTrackIds.has(ann.id)),
    [selectedTrackIds, videoTracks],
  );

  const currentKeyframe = useMemo(
    () => selectedTrack?.geometry.keyframes.find((kf) => kf.frame_index === frameIndex) ?? null,
    [frameIndex, selectedTrack],
  );

  const currentFrameEntries = useMemo(() => {
    const out: VideoFrameEntry[] = [];
    for (const ann of annotations) {
      if (isVideoBbox(ann) && ann.geometry.frame_index === frameIndex) {
        out.push({ id: ann.id, ann, geom: ann.geometry, className: ann.class_name, source: "legacy" });
      } else if (isVideoTrack(ann) && !hiddenTrackIds.has(ann.geometry.track_id)) {
        const resolved = resolveTrackAtFrame(ann.geometry, frameIndex);
        if (resolved) {
          out.push({
            id: ann.id,
            ann,
            geom: resolved.geom,
            className: ann.class_name,
            source: resolved.source,
            occluded: resolved.occluded,
            trackId: ann.geometry.track_id,
          });
        }
      }
    }
    return out;
  }, [annotations, frameIndex, hiddenTrackIds]);

  const selectedTrackGhost = useMemo<VideoTrackGhost | null>(() => {
    if (!selectedTrack || hiddenTrackIds.has(selectedTrack.geometry.track_id)) return null;
    if (currentFrameEntries.some((entry) => entry.ann.id === selectedTrack.id)) return null;
    const nearest = nearestTrackKeyframe(selectedTrack.geometry, frameIndex);
    if (!nearest) return null;
    return {
      id: `ghost-${selectedTrack.id}`,
      ann: selectedTrack,
      geom: nearest.bbox,
      className: selectedTrack.class_name,
      source: "manual",
      trackId: selectedTrack.geometry.track_id,
      originFrame: nearest.frame_index,
    };
  }, [currentFrameEntries, frameIndex, hiddenTrackIds, selectedTrack]);

  const selectedTrackLocked = selectedTrack ? lockedTrackIds.has(selectedTrack.geometry.track_id) : false;

  const selectTrack = useCallback((id: string, opts?: { toggle?: boolean }) => {
    if (opts?.toggle) {
      const next = new Set(selectedTrackIds);
      if (next.has(id) && next.size > 1) {
        next.delete(id);
        setSelectedTrackIds(next);
        onSelect(next.values().next().value ?? id);
        return;
      }
      next.add(id);
      setSelectedTrackIds(next);
      onSelect(id);
      return;
    }
    setSelectedTrackIds(new Set([id]));
    onSelect(id);
  }, [onSelect, selectedTrackIds]);

  const startNewTrack = useCallback(() => {
    setSelectedTrackIds(new Set());
    onSelect(null);
  }, [onSelect]);

  const setSelectedTracksHidden = useCallback((hidden: boolean) => {
    for (const ann of selectedTracks) {
      const isHidden = hiddenTrackIds.has(ann.geometry.track_id);
      if (isHidden !== hidden) onToggleHiddenTrack(ann.geometry.track_id);
    }
  }, [hiddenTrackIds, onToggleHiddenTrack, selectedTracks]);

  const setSelectedTracksLocked = useCallback((locked: boolean) => {
    for (const ann of selectedTracks) {
      const isLocked = lockedTrackIds.has(ann.geometry.track_id);
      if (isLocked !== locked) onToggleLockedTrack(ann.geometry.track_id);
    }
  }, [lockedTrackIds, onToggleLockedTrack, selectedTracks]);

  const renameSelectedTracks = useCallback((className: string) => {
    if (!className || selectedTracks.length <= 1) return;
    onRenameTracks?.(selectedTracks, className);
  }, [onRenameTracks, selectedTracks]);

  const deleteSelectedTracks = useCallback(() => {
    if (selectedTracks.length <= 1 || !onDeleteTracks) return;
    if (!window.confirm(`确定删除 ${selectedTracks.length} 条轨迹？`)) return;
    onDeleteTracks(selectedTracks);
    setSelectedTrackIds(new Set());
  }, [onDeleteTracks, selectedTracks]);

  const markSelectedTrack = useCallback((patch: Partial<VideoTrackKeyframe>) => {
    if (!selectedTrack || readOnly || lockedTrackIds.has(selectedTrack.geometry.track_id)) return;
    if (patch.absent) {
      onUpdate(selectedTrack, addOutsideRange(selectedTrack.geometry, {
        from: frameIndex,
        to: frameIndex,
        source: patch.source === "prediction" ? "prediction" : "manual",
      }));
      return;
    }
    const bbox = nearestTrackBbox(selectedTrack.geometry, frameIndex);
    onUpdate(selectedTrack, upsertKeyframe(removeOutsideFrame(selectedTrack.geometry, frameIndex), frameIndex, bbox, patch));
  }, [frameIndex, lockedTrackIds, onUpdate, readOnly, selectedTrack]);

  const copySelectedTrackToCurrentFrame = useCallback(() => {
    if (!selectedTrack || !selectedTrackGhost || readOnly || lockedTrackIds.has(selectedTrack.geometry.track_id)) return;
    onUpdate(selectedTrack, upsertKeyframe(selectedTrack.geometry, frameIndex, selectedTrackGhost.geom));
  }, [frameIndex, lockedTrackIds, onUpdate, readOnly, selectedTrack, selectedTrackGhost]);

  const deleteTrackKeyframe = useCallback((ann: VideoTrackAnnotation, targetFrame: number) => {
    if (readOnly || lockedTrackIds.has(ann.geometry.track_id) || ann.geometry.keyframes.length <= 1) return;
    onUpdate(ann, {
      ...ann.geometry,
      keyframes: sortedKeyframes(ann.geometry).filter((kf) => kf.frame_index !== targetFrame),
    });
  }, [lockedTrackIds, onUpdate, readOnly]);

  const copyCurrentKeyframe = useCallback(() => {
    if (!selectedTrack || !currentKeyframe) return;
    setCopiedKeyframe({
      trackId: selectedTrack.geometry.track_id,
      className: selectedTrack.class_name,
      frameIndex,
      keyframe: cloneKeyframe(currentKeyframe),
    });
  }, [currentKeyframe, frameIndex, selectedTrack]);

  const pasteKeyframeToCurrentFrame = useCallback(() => {
    if (!selectedTrack || !copiedKeyframe || readOnly || lockedTrackIds.has(selectedTrack.geometry.track_id)) return;
    onUpdate(
      selectedTrack,
      upsertKeyframe(
        selectedTrack.geometry,
        frameIndex,
        copiedKeyframe.keyframe.bbox,
        {
          source: "manual",
          absent: copiedKeyframe.keyframe.absent ?? false,
          occluded: copiedKeyframe.keyframe.occluded ?? false,
        },
      ),
    );
  }, [copiedKeyframe, frameIndex, lockedTrackIds, onUpdate, readOnly, selectedTrack]);

  const copiedKeyframeLabel = copiedKeyframe
    ? `${copiedKeyframe.className} ${shortTrackId(copiedKeyframe.trackId)} · F${copiedKeyframe.frameIndex}`
    : null;

  return (
    <VideoTrackPanel
      videoTracks={videoTracks}
      selectedId={selectedId}
      selectedTrackIds={selectedTrackIds}
      selectedTrack={selectedTrack}
      selectedTrackGhost={selectedTrackGhost}
      selectedTrackLocked={selectedTrackLocked}
      currentFrameOutside={selectedTrack ? isFrameOutside(selectedTrack.geometry, frameIndex) : false}
      frameIndex={frameIndex}
      readOnly={readOnly}
      classes={classes}
      hiddenTrackIds={hiddenTrackIds}
      lockedTrackIds={lockedTrackIds}
      onSelect={selectTrack}
      onToggleHiddenTrack={onToggleHiddenTrack}
      onToggleLockedTrack={onToggleLockedTrack}
      onSeekFrame={onSeekFrame}
      onStartNewTrack={startNewTrack}
      onChangeUserBoxClass={onChangeUserBoxClass}
      onBatchRenameTracks={onRenameTracks ? renameSelectedTracks : undefined}
      onBatchDeleteTracks={onDeleteTracks ? deleteSelectedTracks : undefined}
      onShowSelectedTracks={() => setSelectedTracksHidden(false)}
      onHideSelectedTracks={() => setSelectedTracksHidden(true)}
      onLockSelectedTracks={() => setSelectedTracksLocked(true)}
      onUnlockSelectedTracks={() => setSelectedTracksLocked(false)}
      onMarkSelectedTrack={markSelectedTrack}
      onCopySelectedTrackToCurrentFrame={copySelectedTrackToCurrentFrame}
      copiedKeyframeLabel={copiedKeyframeLabel}
      canCopyCurrentKeyframe={Boolean(selectedTrack && currentKeyframe)}
      canPasteKeyframe={Boolean(copiedKeyframe && selectedTrack && !readOnly && !selectedTrackLocked)}
      onCopyCurrentKeyframe={copyCurrentKeyframe}
      onPasteKeyframeToCurrentFrame={pasteKeyframeToCurrentFrame}
      onDeleteTrackKeyframe={deleteTrackKeyframe}
      onConvertToBboxes={onConvertToBboxes}
    />
  );
}
