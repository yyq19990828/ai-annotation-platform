export interface VideoLoopRegion {
  startFrame: number;
  endFrame: number;
}

export interface VideoBookmark {
  id: string;
  frameIndex: number;
  label?: string;
  createdAt: number;
}

export interface VideoJumpHistory {
  entries: number[];
  cursor: number;
}

const HISTORY_LIMIT = 50;

function cleanFrame(frame: number, maxFrame: number) {
  const safeMax = Math.max(0, Math.floor(maxFrame));
  if (!Number.isFinite(frame)) return 0;
  return Math.max(0, Math.min(safeMax, Math.round(frame)));
}

export function normalizeLoopRegion(
  fromFrame: number,
  toFrame: number,
  maxFrame: number,
): VideoLoopRegion {
  const from = cleanFrame(fromFrame, maxFrame);
  const to = cleanFrame(toFrame, maxFrame);
  return {
    startFrame: Math.min(from, to),
    endFrame: Math.max(from, to),
  };
}

export function bookmarkId(frameIndex: number) {
  return `frame-${frameIndex}`;
}

export function toggleVideoBookmark(
  bookmarks: readonly VideoBookmark[],
  frameIndex: number,
  now = Date.now(),
): VideoBookmark[] {
  const frame = Math.max(0, Math.round(frameIndex));
  if (bookmarks.some((bookmark) => bookmark.frameIndex === frame)) {
    return bookmarks.filter((bookmark) => bookmark.frameIndex !== frame);
  }
  return [
    ...bookmarks,
    {
      id: bookmarkId(frame),
      frameIndex: frame,
      label: `F ${frame}`,
      createdAt: now,
    },
  ].sort((a, b) => a.frameIndex - b.frameIndex || a.createdAt - b.createdAt);
}

export function pushVideoJumpHistory(
  history: VideoJumpHistory,
  frameIndex: number,
): VideoJumpHistory {
  const frame = Math.max(0, Math.round(frameIndex));
  const current = history.entries[history.cursor];
  if (current === frame) return history;
  const entries = history.entries.slice(0, Math.max(0, history.cursor + 1));
  entries.push(frame);
  const limited = entries.slice(-HISTORY_LIMIT);
  return {
    entries: limited,
    cursor: limited.length - 1,
  };
}

export function jumpVideoHistory(
  history: VideoJumpHistory,
  dir: -1 | 1,
): { history: VideoJumpHistory; frameIndex: number | null } {
  if (history.entries.length === 0) return { history, frameIndex: null };
  const nextCursor = Math.max(0, Math.min(history.entries.length - 1, history.cursor + dir));
  if (nextCursor === history.cursor) return { history, frameIndex: null };
  const next = { entries: history.entries, cursor: nextCursor };
  return { history: next, frameIndex: next.entries[next.cursor] };
}

export function emptyVideoJumpHistory(frameIndex = 0): VideoJumpHistory {
  return { entries: [Math.max(0, Math.round(frameIndex))], cursor: 0 };
}

export function videoNavigationStorageKey(taskId: string, kind: "loop" | "bookmarks" | "history") {
  return `workbench.video.${kind}.${taskId}`;
}

export function parseStoredLoopRegion(value: string | null, maxFrame: number): VideoLoopRegion | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<VideoLoopRegion>;
    if (typeof parsed.startFrame !== "number" || typeof parsed.endFrame !== "number") return null;
    return normalizeLoopRegion(parsed.startFrame, parsed.endFrame, maxFrame);
  } catch {
    return null;
  }
}

export function parseStoredBookmarks(value: string | null, maxFrame: number): VideoBookmark[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((bookmark): bookmark is VideoBookmark => (
        bookmark &&
        typeof bookmark.id === "string" &&
        typeof bookmark.frameIndex === "number" &&
        typeof bookmark.createdAt === "number"
      ))
      .map((bookmark) => ({
        ...bookmark,
        frameIndex: cleanFrame(bookmark.frameIndex, maxFrame),
        label: typeof bookmark.label === "string" ? bookmark.label : `F ${cleanFrame(bookmark.frameIndex, maxFrame)}`,
      }))
      .sort((a, b) => a.frameIndex - b.frameIndex || a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

export function parseStoredJumpHistory(value: string | null, maxFrame: number): VideoJumpHistory {
  if (!value) return emptyVideoJumpHistory();
  try {
    const parsed = JSON.parse(value) as Partial<VideoJumpHistory>;
    if (!Array.isArray(parsed.entries)) return emptyVideoJumpHistory();
    const entries = parsed.entries
      .filter((frame): frame is number => typeof frame === "number" && Number.isFinite(frame))
      .map((frame) => cleanFrame(frame, maxFrame))
      .slice(-HISTORY_LIMIT);
    if (entries.length === 0) return emptyVideoJumpHistory();
    return {
      entries,
      cursor: Math.max(0, Math.min(entries.length - 1, Math.round(parsed.cursor ?? entries.length - 1))),
    };
  } catch {
    return emptyVideoJumpHistory();
  }
}
