import { act, fireEvent, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePsrFloatingPanel } from "./usePsrFloatingPanel";

describe("usePsrFloatingPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("moves the shared pet anchor when the linked 3d info panel is dragged", () => {
    const onPositionChange = vi.fn();
    const { result } = renderHook(() =>
      usePsrFloatingPanel("u1", {
        position: { x: 500, y: 400 },
        onPositionChange,
      }),
    );
    const handle = document.createElement("div");

    act(() => {
      result.current.onPsrHeaderPointerDown({
        button: 0,
        clientX: 100,
        clientY: 120,
        target: handle,
      } as unknown as React.PointerEvent);
    });
    fireEvent(window, new MouseEvent("pointermove", { clientX: 132, clientY: 164 }));
    fireEvent(window, new MouseEvent("pointerup"));

    expect(onPositionChange).toHaveBeenLastCalledWith({ x: 532, y: 444 });
    expect(result.current.psrPanel).toEqual({ expanded: false, dx: 0, dy: 0 });
    expect(window.localStorage.getItem("workbench.u1.pcd.psrPanel")).toBeNull();
  });

  it("keeps the independent panel offset when the pet dock is disabled", () => {
    const { result } = renderHook(() => usePsrFloatingPanel("u1"));
    const handle = document.createElement("div");

    act(() => {
      result.current.onPsrHeaderPointerDown({
        button: 0,
        clientX: 100,
        clientY: 120,
        target: handle,
      } as unknown as React.PointerEvent);
    });
    fireEvent(window, new MouseEvent("pointermove", { clientX: 132, clientY: 164 }));
    fireEvent(window, new MouseEvent("pointerup"));

    expect(result.current.psrPanel).toEqual({ expanded: false, dx: 32, dy: 44 });
    expect(window.localStorage.getItem("workbench.u1.pcd.psrPanel")).toBe(
      '{"expanded":false,"dx":32,"dy":44}',
    );
  });
});
