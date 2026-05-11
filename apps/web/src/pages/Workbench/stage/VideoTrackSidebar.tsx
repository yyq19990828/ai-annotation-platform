import { useCallback, useMemo } from "react";
import type { AnnotationResponse, VideoTrackKeyframe } from "@/types";
import {
  isVideoBbox,
  isVideoTrack,
  nearestTrackBbox,
  nearestTrackKeyframe,
  resolveTrackAtFrame,
  sortedKeyframes,
  upsertKeyframe,
} from "./videoStageGeometry";
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
  onSelect: (id: string) => void;
  onToggleHiddenTrack: (trackId: string) => void;
  onToggleLockedTrack: (trackId: string) => void;
  onChangeUserBoxClass?: (id: string) => void;
  onUpdate: (annotation: AnnotationResponse, geometry: VideoTrackAnnotation["geometry"]) => void;
  onConvertToBboxes?: (annotation: AnnotationResponse, options: VideoTrackConversionOptions) => void;
}

export function VideoTrackSidebar({
  annotations,
  selectedId,
  frameIndex,
  readOnly,
  hiddenTrackIds,
  lockedTrackIds,
  onSelect,
  onToggleHiddenTrack,
  onToggleLockedTrack,
  onChangeUserBoxClass,
  onUpdate,
  onConvertToBboxes,
}: VideoTrackSidebarProps) {
  const videoTracks = useMemo(() => annotations.filter(isVideoTrack), [annotations]);
  const selectedTrack = useMemo(
    () => videoTracks.find((ann) => ann.id === selectedId) ?? null,
    [selectedId, videoTracks],
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
    const exact = selectedTrack.geometry.keyframes.find((kf) => kf.frame_index === frameIndex);
    if (exact?.absent) return null;
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

  const markSelectedTrack = useCallback((patch: Partial<VideoTrackKeyframe>) => {
    if (!selectedTrack || readOnly || lockedTrackIds.has(selectedTrack.geometry.track_id)) return;
    const bbox = nearestTrackBbox(selectedTrack.geometry, frameIndex);
    onUpdate(selectedTrack, upsertKeyframe(selectedTrack.geometry, frameIndex, bbox, patch));
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

  return (
    <VideoTrackPanel
      videoTracks={videoTracks}
      selectedId={selectedId}
      selectedTrack={selectedTrack}
      selectedTrackGhost={selectedTrackGhost}
      selectedTrackLocked={selectedTrackLocked}
      frameIndex={frameIndex}
      readOnly={readOnly}
      hiddenTrackIds={hiddenTrackIds}
      lockedTrackIds={lockedTrackIds}
      onSelect={onSelect}
      onToggleHiddenTrack={onToggleHiddenTrack}
      onToggleLockedTrack={onToggleLockedTrack}
      onChangeUserBoxClass={onChangeUserBoxClass}
      onMarkSelectedTrack={markSelectedTrack}
      onCopySelectedTrackToCurrentFrame={copySelectedTrackToCurrentFrame}
      onDeleteTrackKeyframe={deleteTrackKeyframe}
      onConvertToBboxes={onConvertToBboxes}
    />
  );
}
