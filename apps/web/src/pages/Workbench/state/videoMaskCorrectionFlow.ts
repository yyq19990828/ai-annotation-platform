import type { VideoMaskCorrectionIntent } from "../stage/VideoMaskCorrectionDialog";

export type VideoMaskCorrectionFlowOutcome<T> =
  | { kind: "save_failed"; savedKeyframe: null }
  | { kind: "saved"; savedKeyframe: T }
  | { kind: "created"; savedKeyframe: T };

interface ExecuteVideoMaskCorrectionFlowOptions<T> {
  intent: VideoMaskCorrectionIntent;
  savedKeyframe: T | null;
  saveKeyframe: () => Promise<T | null>;
  onKeyframeSaved: (savedKeyframe: T) => void;
  createPropagation: (savedKeyframe: T, intent: VideoMaskCorrectionIntent) => Promise<void>;
}

export async function executeVideoMaskCorrectionFlow<T>({
  intent,
  savedKeyframe,
  saveKeyframe,
  onKeyframeSaved,
  createPropagation,
}: ExecuteVideoMaskCorrectionFlowOptions<T>): Promise<VideoMaskCorrectionFlowOutcome<T>> {
  let saved = savedKeyframe;
  if (!saved) {
    saved = await saveKeyframe();
    if (!saved) return { kind: "save_failed", savedKeyframe: null };
    onKeyframeSaved(saved);
  }
  if (intent.mode === "save_only") {
    return { kind: "saved", savedKeyframe: saved };
  }
  await createPropagation(saved, intent);
  return { kind: "created", savedKeyframe: saved };
}
