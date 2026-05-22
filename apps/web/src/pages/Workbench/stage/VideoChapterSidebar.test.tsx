import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { VideoChapter } from "@/api/videoChapters";

const chaptersRef: { current: VideoChapter[] } = { current: [] };

vi.mock("@/hooks/useVideoChapters", () => ({
  useVideoChapters: () => ({ data: chaptersRef.current, isLoading: false }),
  useCreateVideoChapter: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateVideoChapter: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteVideoChapter: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { VideoChapterSidebar } from "./VideoChapterSidebar";

function chapter(overrides: Partial<VideoChapter>): VideoChapter {
  return {
    id: overrides.id ?? "c1",
    dataset_item_id: "item-1",
    start_frame: 0,
    end_frame: 10,
    title: "章节",
    color: null,
    metadata: {},
    frame_step: null,
    source: "manual",
    created_by: null,
    created_at: "2026-05-21T00:00:00Z",
    updated_at: null,
    ...overrides,
  };
}

function renderSidebar() {
  return render(
    <VideoChapterSidebar
      datasetItemId="item-1"
      frameIndex={0}
      maxFrame={100}
      canEdit={false}
    />,
  );
}

describe("VideoChapterSidebar frame_step / source display", () => {
  it("shows a sampled badge only for sampled chapters", () => {
    chaptersRef.current = [
      chapter({ id: "manual", title: "手动章", source: "manual" }),
      chapter({ id: "sampled", title: "采样章", source: "sampled", start_frame: 20, end_frame: 30 }),
    ];
    const { getAllByTestId, queryAllByText } = renderSidebar();
    expect(getAllByTestId("video-chapter-row")).toHaveLength(2);
    // 仅 sampled 章节出现 "采样" badge。
    expect(queryAllByText("采样")).toHaveLength(1);
  });

  it("renders frame_step when present", () => {
    chaptersRef.current = [
      chapter({ id: "stepped", title: "步长章", frame_step: 5 }),
    ];
    const { getByText } = renderSidebar();
    expect(getByText(/步长 5/)).toBeInTheDocument();
  });

  it("omits step text when frame_step is null", () => {
    chaptersRef.current = [chapter({ id: "nostep", frame_step: null })];
    const { queryByText } = renderSidebar();
    expect(queryByText(/步长/)).toBeNull();
  });
});
