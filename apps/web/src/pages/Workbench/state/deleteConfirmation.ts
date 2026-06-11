import type { WorkbenchCommonPreferences } from "@/api/auth";

export function shouldConfirmAnnotationDelete(
  mode: WorkbenchCommonPreferences["confirmDelete"],
  count: number,
): boolean {
  if (count <= 0) return false;
  return mode === "always" || (mode === "multi_only" && count > 1);
}
