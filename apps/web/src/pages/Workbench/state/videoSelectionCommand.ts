export interface VideoSelectionCommandOptions {
  shift?: boolean;
  frameIndex?: number;
  activateTrackTool?: boolean;
  onAdmitted?: () => void;
}

/** Carries selection and its optional frame change through the same draft guard. */
export type VideoSelectionCommand = (
  id: string | null,
  options?: VideoSelectionCommandOptions,
) => void;
