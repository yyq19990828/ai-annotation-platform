import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Topbar } from "./Topbar";

describe("Topbar · AI 工具入口", () => {
  it("将 AI 追踪放在 AI 单题左侧，并复用同一按钮样式", () => {
    const onToggleTracker = vi.fn();
    const onRunAi = vi.fn();

    render(
      <Topbar
        projectName="测试项目"
        projectDisplayId="P-1"
        task={undefined}
        taskIdx={0}
        taskTotal={1}
        aiRunning={false}
        isSubmitting={false}
        onShowHotkeys={vi.fn()}
        onRunAi={onRunAi}
        onToggleTracker={onToggleTracker}
        trackerOpen
        aiOpen={false}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    const tracker = screen.getByTestId("workbench-ai-tracker");
    const single = screen.getByTestId("workbench-ai-single");

    expect(tracker.nextElementSibling).toBe(single);
    expect(tracker.className).toBe(single.className);
    expect(tracker).toHaveAttribute("aria-pressed", "true");
    expect(tracker).toHaveAccessibleName("发现新目标");
    expect(tracker).toHaveAttribute("title", "聚焦画布级多目标追踪");
    expect(single).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(tracker);
    fireEvent.click(single);
    expect(onToggleTracker).toHaveBeenCalledTimes(1);
    expect(onRunAi).toHaveBeenCalledTimes(1);
  });
});

it("gates layout buttons until preferences settle", () => {
  const toggle = vi.fn();
  render(
    <Topbar
      projectName="测试"
      projectDisplayId="P-1"
      task={undefined}
      taskIdx={0}
      taskTotal={1}
      aiRunning={false}
      isSubmitting={false}
      onShowHotkeys={vi.fn()}
      onRunAi={vi.fn()}
      onPrev={vi.fn()}
      onNext={vi.fn()}
      onSubmit={vi.fn()}
      onToggleSide={toggle}
      sides={{ left: "open", right: "collapsed" }}
      layoutDisabled
      layoutMenuSlot={<button>布局</button>}
    />,
  );
  expect(screen.getByRole("button", { name: "左侧面板" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "右侧面板" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "布局" })).toBeVisible();
});

it("labels physical sides, exposes expanded state, and disables an empty side", () => {
  const toggle = vi.fn();
  render(
    <Topbar
      projectName="测试"
      projectDisplayId="P-1"
      task={undefined}
      taskIdx={0}
      taskTotal={1}
      aiRunning={false}
      isSubmitting={false}
      onShowHotkeys={vi.fn()}
      onPrev={vi.fn()}
      onNext={vi.fn()}
      onSubmit={vi.fn()}
      onToggleSide={toggle}
      sides={{ left: "empty", right: "collapsed" }}
    />,
  );
  expect(screen.getByRole("button", { name: "左侧面板" })).toBeDisabled();
  const right = screen.getByRole("button", { name: "右侧面板" });
  expect(right).toHaveAttribute("aria-expanded", "false");
  expect(right).toHaveAttribute("title", "展开画布右侧所有面板");
  fireEvent.click(right);
  expect(toggle).toHaveBeenCalledWith("right");
});
