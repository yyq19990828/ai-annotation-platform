import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useThreeDHistory } from "./useThreeDHistory";

function makeMutations() {
  return {
    createAnnotation: {
      mutate: vi.fn((payload, options) => {
        options?.onSuccess?.({
          id: "created-id",
          task_id: "t1",
          project_id: null,
          user_id: null,
          source: "manual",
          annotation_type: payload.annotation_type ?? "box_3d",
          class_name: payload.class_name,
          geometry: payload.geometry,
          confidence: 1,
          parent_prediction_id: null,
          parent_annotation_id: null,
          lead_time: null,
          is_active: true,
          ground_truth: false,
          attributes: payload.attributes ?? {},
          created_at: "2026-06-07T00:00:00Z",
          updated_at: null,
        });
      }),
    },
    deleteAnnotation: {
      mutate: vi.fn((_id, options) => options?.onSuccess?.()),
    },
    updateAnnotation: {
      mutate: vi.fn((_args, options) => options?.onSuccess?.()),
    },
  };
}

describe("useThreeDHistory", () => {
  it("delegates update undo / redo to the 3D update mutation", async () => {
    const mutations = makeMutations();
    const { result } = renderHook(() => useThreeDHistory("t1", mutations));
    act(() => {
      result.current.push({
        kind: "update",
        annotationId: "a1",
        before: { class_name: "car" },
        after: { class_name: "truck" },
      });
    });

    await act(async () => {
      await result.current.undo();
    });
    await waitFor(() => expect(result.current.canRedo).toBe(true));
    expect(mutations.updateAnnotation.mutate).toHaveBeenCalledWith(
      { annotationId: "a1", payload: { class_name: "car" } },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );

    await act(async () => {
      await result.current.redo();
    });
    await waitFor(() => expect(result.current.canUndo).toBe(true));
    expect(mutations.updateAnnotation.mutate).toHaveBeenCalledWith(
      { annotationId: "a1", payload: { class_name: "truck" } },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it("delegates create undo and redo to delete/create mutations", async () => {
    const mutations = makeMutations();
    const payload = {
      annotation_type: "box_3d",
      tool_unit_id: "lidar_box_3d",
      class_name: "car",
      geometry: {
        type: "box_3d" as const,
        center: [0, 0, 0] as [number, number, number],
        size: [1, 1, 1] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
      },
    };
    const { result } = renderHook(() => useThreeDHistory("t1", mutations));
    act(() => {
      result.current.push({ kind: "create", annotationId: "a1", payload });
    });

    await act(async () => {
      await result.current.undo();
    });
    await waitFor(() => expect(result.current.canRedo).toBe(true));
    expect(mutations.deleteAnnotation.mutate).toHaveBeenCalledWith(
      "a1",
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );

    await act(async () => {
      await result.current.redo();
    });
    await waitFor(() => expect(result.current.canUndo).toBe(true));
    expect(mutations.createAnnotation.mutate).toHaveBeenCalledWith(
      payload,
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });
});
