/** Drain before reseeding changes project IDs; keep failed work queued for afterAll. */
export async function drainRecordingCleanup<T>(
  records: T[],
  cleanup: (record: T) => void | Promise<void>,
): Promise<void> {
  while (records.length > 0) {
    await cleanup(records[0]);
    records.shift();
  }
}

/** Recover a committed output when its browser response was lost before registration. */
export function recoverRecordingAnnotationIds(
  scope: { taskId: string; baselineAnnotationIds: string[]; annotationIds: string[] },
  observed: unknown,
): void {
  if (!Array.isArray(observed)) throw new Error("Recording annotation recovery requires an array");
  // Validate the whole response before registering anything for deletion.
  const ids = observed.map((item: unknown) => {
    if (
      !item ||
      typeof item !== "object" ||
      !("id" in item) ||
      typeof item.id !== "string" ||
      !item.id ||
      !("task_id" in item) ||
      item.task_id !== scope.taskId
    )
      throw new Error("Recording annotation recovery is outside its task scope");
    return item.id;
  });
  const baseline = new Set(scope.baselineAnnotationIds);
  for (const id of ids)
    if (!baseline.has(id) && !scope.annotationIds.includes(id)) scope.annotationIds.push(id);
}
