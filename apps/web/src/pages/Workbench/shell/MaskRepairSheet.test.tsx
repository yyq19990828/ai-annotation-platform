import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dryRunMutate: vi.fn(),
  dryRunReset: vi.fn(),
  executeMutate: vi.fn(),
  executeReset: vi.fn(),
  rollbackMutate: vi.fn(),
  rollbackReset: vi.fn(),
  resumeMutate: vi.fn(),
  resumeReset: vi.fn(),
  batchData: null as unknown,
}));

vi.mock("@/hooks/useMaskQc", () => ({
  useDryRunMaskRepairs: () => ({
    data: {
      receipt: "mrp_receipt",
      plan_digest: "a".repeat(64),
      expires_at: "2026-07-23T01:00:00Z",
      summary: {
        action_count: 1,
        executable_count: 1,
        skipped_count: 0,
        mutation_count: 1,
        candidate_count: 0,
        changed_pixels: 37,
        shard_count: 1,
      },
      items: [
        {
          issue_id: "issue-1",
          task_id: "task-1",
          annotation_ids: ["annotation-1"],
          kind: "delete_small_islands",
          frame_index: null,
          source_versions: { "annotation-1": 3 },
          changed_pixels: 37,
          mutation_count: 1,
          candidate_count: 0,
          scope_fingerprint: "b".repeat(64),
          skip_code: null,
          skip_detail: null,
        },
      ],
    },
    mutate: mocks.dryRunMutate,
    reset: mocks.dryRunReset,
    isPending: false,
    isError: false,
    error: null,
  }),
  useExecuteMaskRepairs: () => ({
    data: null,
    mutate: mocks.executeMutate,
    reset: mocks.executeReset,
    isPending: false,
    isError: false,
    error: null,
  }),
  useMaskRepairBatch: () => ({
    data: mocks.batchData,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useRollbackMaskRepairs: () => ({
    data: null,
    mutate: mocks.rollbackMutate,
    reset: mocks.rollbackReset,
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
  }),
  useResumeMaskRepairs: () => ({
    data: null,
    mutate: mocks.resumeMutate,
    reset: mocks.resumeReset,
    isPending: false,
    isError: false,
    error: null,
  }),
}));

import { MaskRepairSheet } from "./MaskRepairSheet";

describe("MaskRepairSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.batchData = null;
  });

  it("打开后先请求 dry-run，并用精确计数提交冻结收据", async () => {
    render(
      <MaskRepairSheet
        open
        projectId="project-1"
        actions={[{ issue_id: "issue-1", kind: "delete_small_islands" }]}
        onOpenChange={vi.fn()}
        onFinished={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(mocks.dryRunMutate).toHaveBeenCalledWith([
        { issue_id: "issue-1", kind: "delete_small_islands" },
      ]);
    });
    expect(screen.getByText("37")).toBeTruthy();
    expect(screen.getByText("原子分片")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "确认修复 (1)" }));
    expect(mocks.executeMutate).toHaveBeenCalledWith(
      { receipt: "mrp_receipt", planDigest: "a".repeat(64) },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("部分失败时可以重试未完成分片", () => {
    mocks.batchData = {
      id: "repair-1",
      project_id: "project-1",
      async_job_id: "job-1",
      rollback_async_job_id: null,
      status: "partial",
      plan_digest: "a".repeat(64),
      plan: {},
      result: {},
      result_digest: "b".repeat(64),
      receipt_expires_at: "2026-07-23T01:00:00Z",
      rollback_expires_at: "2099-07-30T01:00:00Z",
      created_at: "2026-07-23T00:00:00Z",
      completed_at: "2026-07-23T00:01:00Z",
      rolled_back_at: null,
    };

    render(
      <MaskRepairSheet
        open
        projectId="project-1"
        actions={[{ issue_id: "issue-1", kind: "delete_small_islands" }]}
        onOpenChange={vi.fn()}
        onFinished={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "重试未完成分片" }));
    expect(mocks.resumeMutate).toHaveBeenCalledWith(
      "repair-1",
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });
});
