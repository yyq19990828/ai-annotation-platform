import { fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
  invalidateQueries: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (...args: unknown[]) => mocks.useQuery(...args),
  useMutation: (...args: unknown[]) => mocks.useMutation(...args),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock("@/api/videoTracker", () => ({
  videoTrackerApi: {
    trackQuality: vi.fn(),
    trackQualityDetail: vi.fn(),
    acceptTrackQuality: vi.fn(),
    reopenSegment: vi.fn(),
    runTrackQuality: vi.fn(),
  },
}));

vi.mock("@/components/ui/Button", () => ({
  Button: ({ children, ...props }: { children: ReactNode } & Record<string, unknown>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@/components/ui/Icon", () => ({ Icon: () => null }));

import { VideoTrackQualitySidebar } from "./VideoTrackQualitySidebar";

describe("VideoTrackQualitySidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useQuery.mockImplementation((options: { queryKey: unknown[] }) => {
      if (options.queryKey.length === 2) {
        return {
          data:
            options.queryKey[1] === "task-1"
              ? [{ id: "run-1", status: "completed" }]
              : [{ id: "run-2", status: "completed" }],
          isLoading: false,
        };
      }
      return { data: undefined, isLoading: false };
    });
    mocks.useMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
  });

  it("replaces a selected run before requesting detail for the next task", () => {
    const view = render(<VideoTrackQualitySidebar taskId="task-1" onSeekFrame={vi.fn()} />);
    fireEvent.click(view.getByRole("button", { name: "B1 · completed" }));

    view.rerender(<VideoTrackQualitySidebar taskId="task-2" onSeekFrame={vi.fn()} />);

    const detailKeys = mocks.useQuery.mock.calls
      .map(([options]) => (options as { queryKey: unknown[] }).queryKey)
      .filter((key) => key.length === 3);
    expect(detailKeys[detailKeys.length - 1]).toEqual(["video-track-quality", "task-2", "run-2"]);
  });
});
