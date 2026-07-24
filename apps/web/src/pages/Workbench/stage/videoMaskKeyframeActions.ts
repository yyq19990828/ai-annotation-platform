import type { AnnotationResponse } from "@/types";

export interface VideoMaskKeyframeActionHandlers {
  clipboardLabel: string | null;
  hasClipboard: boolean;
  busy: boolean;
  copyCurrent: (annotation: AnnotationResponse) => void;
  pasteSameTrack: (annotation: AnnotationResponse) => void;
  pasteNewTrack: (annotation: AnnotationResponse) => void;
  deleteCurrentKeyframe: (annotation: AnnotationResponse) => void;
  toggleCurrentOutside: (annotation: AnnotationResponse) => void;
  splitCurrentComponents: (annotation: AnnotationResponse) => void;
}
