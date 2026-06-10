/**
 * v0.15.1 · CrossFrameInterpolateBar 单测: 展开/折叠、按钮禁用逻辑、
 * 目标帧反查(命中/超范围)与回调分发。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CrossFrameInterpolateBar } from "./CrossFrameInterpolateBar";

const mockNeighbors = vi.hoisted(() => ({ data: null as unknown }));
vi.mock("@/hooks/useFrameNeighbors", () => ({
  useFrameNeighbors: () => ({ data: mockNeighbors.data, isLoading: false, error: null }),
}));

function setNeighbors(prev: [number, string][], next: [number, string][]) {
  mockNeighbors.data = {
    scene_id: "scn-1",
    frame_index: 5,
    scene_total_frames: 39,
    prev: prev.map(([frame_index, task_id]) => ({ frame_index, task_id })),
    next: next.map(([frame_index, task_id]) => ({ frame_index, task_id })),
  };
}

const baseProps = {
  taskId: "t-cur",
  frameIndex: 5,
  sceneTotalFrames: 39,
  selectedGroupId: 1_000_000_001 as number | null,
  selectedIsBox3d: true,
  readOnly: false,
  onPropagateBatch: vi.fn(),
  onPropagateToTask: vi.fn(),
  onInterpolate: vi.fn(),
  pushToast: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  setNeighbors([], []);
});

function openBar(overrides: Partial<typeof baseProps> = {}) {
  const props = { ...baseProps, ...overrides };
  render(<CrossFrameInterpolateBar {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "跨帧工具" }));
  return props;
}

describe("CrossFrameInterpolateBar", () => {
  it("折叠态只渲染入口按钮,展开后出现操作组", () => {
    render(<CrossFrameInterpolateBar {...baseProps} />);
    expect(screen.queryByRole("group", { name: "跨帧工具" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "跨帧工具" }));
    expect(screen.getByRole("group", { name: "跨帧工具" })).toBeInTheDocument();
  });

  it("批量延续按钮直接分发 next", () => {
    const props = openBar();
    fireEvent.click(screen.getByRole("button", { name: "批量延续→" }));
    expect(props.onPropagateBatch).toHaveBeenCalledWith("next");
  });

  it("目标帧命中邻帧反查表 → onPropagateToTask(taskId, frame)", () => {
    setNeighbors([], [[8, "t-8"]]);
    const props = openBar();
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "延续到帧" }));
    expect(props.onPropagateToTask).toHaveBeenCalledWith("t-8", 8);
  });

  it("目标帧超出反查范围 → toast 提示且不分发", () => {
    setNeighbors([], [[8, "t-8"]]);
    const props = openBar();
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "插值填充" }));
    expect(props.onInterpolate).not.toHaveBeenCalled();
    expect(props.pushToast).toHaveBeenCalled();
  });

  it("插值填充命中 → onInterpolate(groupId, toTaskId)", () => {
    setNeighbors([], [[8, "t-8"]]);
    const props = openBar();
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "插值填充" }));
    expect(props.onInterpolate).toHaveBeenCalledWith(1_000_000_001, "t-8");
  });

  it("无选中 box_3d → 「延续到帧」禁用;无 group → 「插值填充」禁用", () => {
    openBar({ selectedIsBox3d: false, selectedGroupId: null });
    expect(screen.getByRole("button", { name: "延续到帧" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "插值填充" })).toBeDisabled();
  });

  it("readOnly 时操作按钮全部禁用", () => {
    openBar({ readOnly: true });
    expect(screen.getByRole("button", { name: "批量延续→" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "延续到帧" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "插值填充" })).toBeDisabled();
  });
});
