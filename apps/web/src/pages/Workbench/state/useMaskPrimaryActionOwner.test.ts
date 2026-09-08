import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useMaskPrimaryActionOwner } from "./useMaskPrimaryActionOwner";
import type { MaskPrimaryActionsInput } from "./maskPrimaryActions";

function state(overrides: Partial<MaskPrimaryActionsInput> = {}): MaskPrimaryActionsInput {
  return {
    active: true,
    phase: "dirty",
    dirty: true,
    canEdit: true,
    canCommit: true,
    revision: 1,
    operationStatus: "idle",
    operationPreview: null,
    instanceOperationPreview: null,
    ...overrides,
  };
}
function region(afterArea = 1): MaskPrimaryActionsInput["operationPreview"] {
  return {
    id: 3,
    name: "erode",
    sourceRevision: 1,
    alpha: new Uint8Array([1]),
    report: {
      beforeArea: 2,
      afterArea,
      changedPixels: 1,
      beforeComponents: 1,
      afterComponents: 1,
      beforeHoles: 0,
      afterHoles: 0,
      bounds: null,
    },
  };
}
function setup(initial = state()) {
  const callbacks = {
    busyRef: { current: false },
    onSave: vi.fn(async () => true),
    onCommitInstances: vi.fn(async () => true),
    onApplyRegion: vi.fn(() => true),
    onCancelPreview: vi.fn(),
    onRecoverSession: vi.fn(),
    onRefreshInstances: vi.fn(async () => {}),
    onExit: vi.fn(async () => {}),
    onError: vi.fn(),
  };
  const props = { owner: {}, state: initial };
  const hook = renderHook((current) => useMaskPrimaryActionOwner({ ...callbacks, ...current }), {
    initialProps: props,
  });
  return { ...hook, ...callbacks, props };
}

describe("useMaskPrimaryActionOwner", () => {
  it("reserves the full asynchronous save before RLE preparation or class selection", async () => {
    const view = setup();
    let release!: (value: boolean) => void;
    view.onSave.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    let first!: Promise<boolean>;
    await act(async () => {
      first = view.result.current.runPrimary();
      expect(await view.result.current.runPrimary()).toBe(false);
      await view.result.current.runSecondary();
    });
    expect(view.onSave).toHaveBeenCalledTimes(1);
    expect(view.onExit).not.toHaveBeenCalled();
    expect(view.result.current.actions.primary.disabled).toBe(true);
    expect(view.busyRef.current).toBe(true);
    await act(async () => {
      release(true);
      expect(await first).toBe(true);
    });
    expect(view.busyRef.current).toBe(false);
  });

  it("applying a region cannot be mistaken for persistence when leaving", async () => {
    const view = setup(state({ operationStatus: "preview", operationPreview: region() }));
    await act(async () => {
      expect(await view.result.current.saveBeforeLeave()).toBe(false);
      expect(await view.result.current.runPrimary()).toBe(false);
    });
    expect(view.onSave).not.toHaveBeenCalled();
    expect(view.onApplyRegion).toHaveBeenCalledOnce();
    view.rerender({ ...view.props, state: state({ revision: 2 }) });
    await act(async () => {
      expect(await view.result.current.saveBeforeLeave()).toBe(true);
    });
    expect(view.onSave).toHaveBeenCalledOnce();
  });

  it("an empty region requires the same explicit confirmation for every primary entry", async () => {
    const view = setup(state({ operationStatus: "preview", operationPreview: region(0) }));
    await act(async () => {
      await view.result.current.runPrimary();
    });
    expect(view.result.current.emptyConfirmationOpen).toBe(true);
    expect(view.onApplyRegion).not.toHaveBeenCalled();
    act(() => view.result.current.closeEmptyConfirmation());
    expect(view.result.current.emptyConfirmationOpen).toBe(false);
    await act(async () => {
      await view.result.current.runPrimary();
    });
    act(() => view.result.current.confirmEmptyRegion());
    expect(view.onApplyRegion).toHaveBeenCalledOnce();
    expect(view.onSave).not.toHaveBeenCalled();
  });

  it.each(["owner", "revision", "preview"])(
    "a stale %s cannot apply an open empty-result confirmation",
    async (boundary) => {
      const view = setup(state({ operationStatus: "preview", operationPreview: region(0) }));
      await act(async () => {
        await view.result.current.runPrimary();
      });
      const lateConfirm = view.result.current.confirmEmptyRegion;
      view.rerender({
        owner: boundary === "owner" ? {} : view.props.owner,
        state: {
          ...view.props.state,
          ...(boundary === "revision" ? { revision: 2 } : {}),
          ...(boundary === "preview" ? { operationPreview: { ...region(0)!, id: 4 } } : {}),
        },
      });
      expect(view.result.current.emptyConfirmationOpen).toBe(false);
      act(() => lateConfirm());
      expect(view.onApplyRegion).not.toHaveBeenCalled();
    },
  );

  it("Esc cancels only the preview, while a dirty exit goes through the existing guard", async () => {
    const view = setup(state({ operationStatus: "preview", operationPreview: region() }));
    await act(async () => {
      await view.result.current.runSecondary();
    });
    expect(view.onCancelPreview).toHaveBeenCalledOnce();
    expect(view.onExit).not.toHaveBeenCalled();
    view.rerender({ ...view.props, state: state() });
    await act(async () => {
      await view.result.current.runSecondary();
    });
    expect(view.onExit).toHaveBeenCalledOnce();
  });

  it("recovering an error does not retry a network write or report a saved exit", async () => {
    const view = setup(
      state({ phase: "error", canEdit: false, canCommit: false, editBlockReason: "editor_error" }),
    );
    await act(async () => {
      expect(await view.result.current.saveBeforeLeave()).toBe(false);
      expect(await view.result.current.runPrimary()).toBe(false);
    });
    expect(view.onRecoverSession).toHaveBeenCalledOnce();
    expect(view.onSave).not.toHaveBeenCalled();
  });

  it("low memory blocks editing without blocking persistence of the current draft", async () => {
    const view = setup(
      state({ canEdit: false, canCommit: true, editBlockReason: "large_canvas_budget_exceeded" }),
    );
    await act(async () => {
      expect(await view.result.current.runPrimary()).toBe(true);
    });
    expect(view.onSave).toHaveBeenCalledOnce();
  });

  it("errors from an old owner do not report into the current task", async () => {
    const view = setup();
    let reject!: (error: Error) => void;
    view.onSave.mockImplementation(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    );
    let pending!: Promise<boolean>;
    act(() => {
      pending = view.result.current.runPrimary();
    });
    view.rerender({ ...view.props, owner: {} });
    await act(async () => {
      reject(new Error("old request"));
      expect(await pending).toBe(false);
    });
    expect(view.onError).not.toHaveBeenCalled();
    expect(view.busyRef.current).toBe(false);
  });
});
