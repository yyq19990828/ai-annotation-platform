import { describe, expect, it } from "vitest";
import {
  emptyVideoJumpHistory,
  jumpVideoHistory,
  normalizeLoopRegion,
  parseStoredBookmarks,
  parseStoredJumpHistory,
  parseStoredLoopRegion,
  pushVideoJumpHistory,
  toggleVideoBookmark,
} from "./videoNavigationState";

describe("videoNavigationState", () => {
  it("normalizes loop regions inside frame bounds", () => {
    expect(normalizeLoopRegion(8, 2, 9)).toEqual({ startFrame: 2, endFrame: 8 });
    expect(normalizeLoopRegion(-3, 20, 9)).toEqual({ startFrame: 0, endFrame: 9 });
  });

  it("toggles bookmarks by frame and keeps them sorted", () => {
    let bookmarks = toggleVideoBookmark([], 5, 100);
    bookmarks = toggleVideoBookmark(bookmarks, 2, 101);

    expect(bookmarks.map((bookmark) => bookmark.frameIndex)).toEqual([2, 5]);
    expect(bookmarks[0].label).toBe("F 2");

    bookmarks = toggleVideoBookmark(bookmarks, 5, 102);
    expect(bookmarks.map((bookmark) => bookmark.frameIndex)).toEqual([2]);
  });

  it("pushes jump history with de-duplication and back-forward navigation", () => {
    let history = emptyVideoJumpHistory(0);
    history = pushVideoJumpHistory(history, 4);
    history = pushVideoJumpHistory(history, 4);
    history = pushVideoJumpHistory(history, 8);

    expect(history).toEqual({ entries: [0, 4, 8], cursor: 2 });

    const back = jumpVideoHistory(history, -1);
    expect(back.frameIndex).toBe(4);
    expect(back.history.cursor).toBe(1);

    const forward = jumpVideoHistory(back.history, 1);
    expect(forward.frameIndex).toBe(8);
    expect(forward.history.cursor).toBe(2);
  });

  it("truncates forward history after back navigation", () => {
    let history = emptyVideoJumpHistory(0);
    history = pushVideoJumpHistory(history, 4);
    history = pushVideoJumpHistory(history, 8);
    history = jumpVideoHistory(history, -1).history;
    history = pushVideoJumpHistory(history, 6);

    expect(history).toEqual({ entries: [0, 4, 6], cursor: 2 });
  });

  it("parses persisted navigation state defensively", () => {
    expect(parseStoredLoopRegion(JSON.stringify({ startFrame: 9, endFrame: 2 }), 10)).toEqual({ startFrame: 2, endFrame: 9 });
    expect(parseStoredLoopRegion("not-json", 10)).toBeNull();

    expect(parseStoredBookmarks(JSON.stringify([
      { id: "a", frameIndex: 12, createdAt: 2 },
      { id: "bad", frameIndex: "x", createdAt: 1 },
    ]), 9)).toEqual([{ id: "a", frameIndex: 9, label: "F 9", createdAt: 2 }]);

    expect(parseStoredJumpHistory(JSON.stringify({ entries: [0, 3, 12], cursor: 99 }), 9)).toEqual({
      entries: [0, 3, 9],
      cursor: 2,
    });
    expect(parseStoredJumpHistory("bad", 9)).toEqual({ entries: [0], cursor: 0 });
  });
});
