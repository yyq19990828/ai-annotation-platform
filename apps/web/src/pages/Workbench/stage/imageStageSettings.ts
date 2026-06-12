import type { WorkbenchImagePreferences } from "@/api/auth";

export function classNameForCommittedDrawing(
  afterBoxCreate: WorkbenchImagePreferences["afterBoxCreate"],
  activeClass: string,
): string | undefined {
  return afterBoxCreate === "reuse_active" && activeClass ? activeClass : undefined;
}

export function wheelZoomFactor(deltaY: number, zoomStepFactor: number): number {
  return deltaY < 0 ? zoomStepFactor : 1 / zoomStepFactor;
}
