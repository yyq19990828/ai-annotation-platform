import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { predictionsApi } from "@/api/predictions";

import { PredictionPurgeModal } from "./PredictionPurgeModal";

vi.mock("@/api/predictions", () => ({
  predictionsApi: {
    purge: vi.fn(),
  },
}));

const purgeMock = predictionsApi.purge as unknown as ReturnType<typeof vi.fn>;

describe("PredictionPurgeModal", () => {
  beforeEach(() => {
    purgeMock.mockReset();
  });

  it("打开后先 dry-run 统计，再确认清理外部导入预测", async () => {
    purgeMock
      .mockResolvedValueOnce({
        source_scope: "external_import",
        task_ids: null,
        dry_run: true,
        counts: { ml_backend: 0, external_import: 3, unknown: 0, total: 3 },
      })
      .mockResolvedValueOnce({
        source_scope: "external_import",
        task_ids: null,
        dry_run: false,
        counts: { ml_backend: 0, external_import: 3, unknown: 0, total: 3 },
      });
    const onComplete = vi.fn();

    render(
      <PredictionPurgeModal open projectId="p-1" onClose={() => {}} onComplete={onComplete} />,
    );

    await waitFor(() => {
      expect(purgeMock).toHaveBeenCalledWith("p-1", {
        source_scope: "external_import",
        task_ids: null,
        dry_run: true,
      });
    });
    expect(screen.getAllByText("3").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /确认清理/ }));
    await waitFor(() => expect(purgeMock).toHaveBeenCalledTimes(2));
    expect(purgeMock).toHaveBeenLastCalledWith("p-1", {
      source_scope: "external_import",
      task_ids: null,
      dry_run: false,
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("清理 ML Backend 预标需要显式确认", async () => {
    purgeMock.mockResolvedValue({
      source_scope: "ml_backend",
      task_ids: null,
      dry_run: true,
      counts: { ml_backend: 2, external_import: 0, unknown: 0, total: 2 },
    });

    render(<PredictionPurgeModal open projectId="p-2" onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText(/来源范围/), {
      target: { value: "ml_backend" },
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /确认清理/ })).toBeDisabled();
    });
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: /确认清理/ })).not.toBeDisabled();
  });
});
