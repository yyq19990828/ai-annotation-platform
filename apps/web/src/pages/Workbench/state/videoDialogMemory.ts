export type VideoDialogMemoryKey = "kfPropagate" | "trackerPropagate";

export function videoDialogMemoryStorageKey(
  userId: string,
  key: VideoDialogMemoryKey,
): string {
  return `workbench.${userId}.video.${key}`;
}

export function readDialogMemory<T>(
  userId: string | null | undefined,
  key: VideoDialogMemoryKey,
  validate: (value: unknown) => T | null,
): T | null {
  if (!userId || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(videoDialogMemoryStorageKey(userId, key));
    if (!raw) return null;
    return validate(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeDialogMemory<T>(
  userId: string | null | undefined,
  key: VideoDialogMemoryKey,
  value: T,
): void {
  if (!userId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      videoDialogMemoryStorageKey(userId, key),
      JSON.stringify(value),
    );
  } catch {
    /* local dialog memory is best-effort */
  }
}
