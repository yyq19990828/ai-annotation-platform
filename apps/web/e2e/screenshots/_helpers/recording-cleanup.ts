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
