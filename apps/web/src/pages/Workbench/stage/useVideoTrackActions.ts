import { useCallback, useMemo } from "react";
import type { AnnotationResponse } from "@/types";
import {
  nearestTrackBbox,
  upsertKeyframe,
} from "./videoStageGeometry";
import { addOutsideRange, isFrameOutside, removeOutsideFrame } from "./videoTrackOutside";
import type { VideoTrackAnnotation } from "./videoStageTypes";

export type TrackMarkPatch = {
  outside?: boolean;
  occluded?: boolean;
  source?: "manual" | "prediction";
};

interface UseVideoTrackActionsArgs {
  selectedTrack: VideoTrackAnnotation | null;
  frameIndex: number;
  readOnly: boolean;
  hiddenTrackIds: Set<string>;
  lockedTrackIds: Set<string>;
  onUpdate: (annotation: AnnotationResponse, geometry: VideoTrackAnnotation["geometry"]) => void;
  onToggleHiddenTrack?: (trackId: string) => void;
  onToggleLockedTrack?: (trackId: string) => void;
  onPropagateTrack?: (annotation: VideoTrackAnnotation) => void;
}

export function useVideoTrackActions({
  selectedTrack,
  frameIndex,
  readOnly,
  hiddenTrackIds,
  lockedTrackIds,
  onUpdate,
  onToggleHiddenTrack,
  onToggleLockedTrack,
  onPropagateTrack,
}: UseVideoTrackActionsArgs) {
  const selectedTrackId = selectedTrack?.geometry.track_id ?? null;
  const selectedTrackLocked = Boolean(selectedTrackId && lockedTrackIds.has(selectedTrackId));
  const currentFrameOutside = Boolean(selectedTrack && isFrameOutside(selectedTrack.geometry, frameIndex));
  const currentFrameOccluded = Boolean(
    selectedTrack
    && !currentFrameOutside
    && selectedTrack.geometry.keyframes.find((kf) => kf.frame_index === frameIndex)?.occluded,
  );
  const canEditSelectedTrack = Boolean(selectedTrack && !readOnly && !selectedTrackLocked);

  const markSelectedTrack = useCallback((patch: TrackMarkPatch) => {
    if (!selectedTrack || readOnly || lockedTrackIds.has(selectedTrack.geometry.track_id)) return;
    if (patch.outside) {
      onUpdate(selectedTrack, addOutsideRange(selectedTrack.geometry, {
        from: frameIndex,
        to: frameIndex,
        source: patch.source === "prediction" ? "prediction" : "manual",
      }));
      return;
    }
    const visibleTrack = removeOutsideFrame(selectedTrack.geometry, frameIndex);
    const bbox = nearestTrackBbox(visibleTrack, frameIndex);
    const keyframePatch = patch.source
      ? { occluded: patch.occluded, source: patch.source }
      : { occluded: patch.occluded };
    onUpdate(
      selectedTrack,
      upsertKeyframe(
        visibleTrack,
        frameIndex,
        bbox,
        keyframePatch,
      ),
    );
  }, [frameIndex, lockedTrackIds, onUpdate, readOnly, selectedTrack]);

  const toggleSelectedTrackOutside = useCallback(() => {
    markSelectedTrack(currentFrameOutside
      ? { outside: false, occluded: false }
      : { outside: true, occluded: false });
  }, [currentFrameOutside, markSelectedTrack]);

  const toggleSelectedTrackOccluded = useCallback(() => {
    markSelectedTrack(currentFrameOccluded
      ? { outside: false, occluded: false }
      : { outside: false, occluded: true });
  }, [currentFrameOccluded, markSelectedTrack]);

  const toggleSelectedTrackHidden = useCallback(() => {
    if (!selectedTrackId || readOnly || !onToggleHiddenTrack) return;
    onToggleHiddenTrack(selectedTrackId);
  }, [onToggleHiddenTrack, readOnly, selectedTrackId]);

  const toggleSelectedTrackLocked = useCallback(() => {
    if (!selectedTrackId || readOnly || !onToggleLockedTrack) return;
    onToggleLockedTrack(selectedTrackId);
  }, [onToggleLockedTrack, readOnly, selectedTrackId]);

  const propagateSelectedTrack = useCallback(() => {
    if (!selectedTrack || readOnly || selectedTrackLocked || !onPropagateTrack) return;
    onPropagateTrack(selectedTrack);
  }, [onPropagateTrack, readOnly, selectedTrack, selectedTrackLocked]);

  return useMemo(() => ({
    selectedTrackHidden: Boolean(selectedTrackId && hiddenTrackIds.has(selectedTrackId)),
    selectedTrackLocked,
    currentFrameOutside,
    currentFrameOccluded,
    canEditSelectedTrack,
    markSelectedTrack,
    toggleSelectedTrackOutside,
    toggleSelectedTrackOccluded,
    toggleSelectedTrackHidden,
    toggleSelectedTrackLocked,
    propagateSelectedTrack,
  }), [
    canEditSelectedTrack,
    currentFrameOccluded,
    currentFrameOutside,
    hiddenTrackIds,
    markSelectedTrack,
    propagateSelectedTrack,
    selectedTrackId,
    selectedTrackLocked,
    toggleSelectedTrackHidden,
    toggleSelectedTrackLocked,
    toggleSelectedTrackOccluded,
    toggleSelectedTrackOutside,
  ]);
}
