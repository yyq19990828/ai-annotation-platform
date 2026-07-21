import { act, renderHook } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { aiMasksApi, type AiMaskAcceptResponse } from "@/api/aiMasks";
import type { AnnotationResponse, PredictionResponse } from "@/types";
import type { PendingMaskCandidate } from "@/pages/Workbench/state/useInteractiveAI";
import { useAcceptNativeMaskCandidate } from "./useAcceptNativeMaskCandidate";

function candidate(): PendingMaskCandidate {
  return {
    id: `sha256:${"a".repeat(64)}`,
    type: "mask",
    rle: { encoding: "coco_rle", size: [2, 3], counts: [1, 2, 3] },
    candidateId: `sha256:${"a".repeat(64)}`,
    candidateIndex: 0,
    promptRevision: "revision-1",
    receipt: "signed-receipt-value",
    idempotencyKey: "mask:stable-idempotency-key",
    promptSummary: {
      family: "point",
      positive_points: 1,
      negative_points: 0,
      boxes: 0,
      positive_scribbles: 0,
      negative_scribbles: 0,
      multimask: true,
    },
    routing: {
      requested_backend_id: "backend-requested",
      backend_pool_id: "pool-1",
      backend_instance_id: "backend-instance",
      model_id: "sam-image",
    },
    inference: {
      model_version: "sam-1",
      inference_time_ms: 12,
      cache_hit: false,
      model_load_ms: 3,
    },
    label: "object",
    score: 0.9,
    source: "point",
  };
}

function response(): AiMaskAcceptResponse {
  return {
    prediction: { id: "prediction-1" } as PredictionResponse,
    annotation: {
      id: "annotation-1",
      geometry: {
        type: "raster_mask",
        mask: {
          encoding: "coco_rle_ref",
          size: [2, 3],
          object_key: "raster-masks/content.json",
          sha256: "b".repeat(64),
          runs: 3,
          bytes: 64,
        },
      },
    } as AnnotationResponse,
    source_version: null,
    result_version: 1,
    content_digest: "b".repeat(64),
    replayed: false,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("useAcceptNativeMaskCandidate", () => {
  it("成功后以服务端 annotation 更新缓存并写入接受历史", async () => {
    const queryClient = new QueryClient();
    const push = vi.fn();
    const accepted = response();
    const request = vi.spyOn(aiMasksApi, "accept").mockResolvedValue(accepted);
    const view = renderHook(() => useAcceptNativeMaskCandidate({
      taskId: "task-1",
      queryClient,
      history: { push },
    }));

    let result: AiMaskAcceptResponse | undefined;
    await act(async () => {
      result = await view.result.current({
        candidate: candidate(),
        className: "car",
        target: { mode: "create" },
      });
    });

    expect(result).toBe(accepted);
    expect(request).toHaveBeenCalledWith("task-1", expect.objectContaining({
      idempotency_key: "mask:stable-idempotency-key",
      class_name: "car",
      target: { mode: "create" },
    }));
    expect(queryClient.getQueryData(["annotations", "task-1"])).toEqual([
      accepted.annotation,
    ]);
    expect(push).toHaveBeenCalledWith({
      kind: "acceptPrediction",
      predictionId: "prediction-1",
      createdAnnotationIds: ["annotation-1"],
    });
  });

  it("同幂等键阻止并发双击；失败后释放 single-flight 供原键重试", async () => {
    const queryClient = new QueryClient();
    const push = vi.fn();
    let rejectFirst!: (reason: unknown) => void;
    const first = new Promise<AiMaskAcceptResponse>((_resolve, reject) => {
      rejectFirst = reject;
    });
    const request = vi.spyOn(aiMasksApi, "accept")
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(response());
    const item = candidate();
    const view = renderHook(() => useAcceptNativeMaskCandidate({
      taskId: "task-1",
      queryClient,
      history: { push },
    }));

    const pending = view.result.current({
      candidate: item,
      className: "car",
      target: { mode: "create" },
    });
    await expect(view.result.current({
      candidate: item,
      className: "car",
      target: { mode: "create" },
    })).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(1);

    rejectFirst(new Error("network lost"));
    await expect(pending).rejects.toThrow("network lost");
    await expect(view.result.current({
      candidate: item,
      className: "car",
      target: { mode: "create" },
    })).resolves.toEqual(response());
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][1].idempotency_key).toBe(
      request.mock.calls[1][1].idempotency_key,
    );
  });
});
