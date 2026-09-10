import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Topbar } from "./Topbar";

it("preserves native segment selector keys without activating overflow menu actions", () => {
  const onSmartNextOpen = vi.fn();
  const onSelectVideoSegment = vi.fn();
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
      onSmartNextOpen={onSmartNextOpen}
      videoSegments={[]}
      onSelectVideoSegment={onSelectVideoSegment}
    />,
  );
  const trigger = screen.getByRole("button", { name: "更多工具" });
  fireEvent.click(trigger);
  const menu = screen.getByRole("menu");
  const select = within(menu).getByRole("combobox", { name: "当前视频分段" });
  select.focus();
  for (const key of ["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "]) {
    expect(fireEvent.keyDown(select, { key })).toBe(true);
    expect(select).toHaveFocus();
    expect(menu).toBeInTheDocument();
    expect(onSmartNextOpen).not.toHaveBeenCalled();
  }
  fireEvent.change(select, { target: { value: "" } });
  expect(onSelectVideoSegment).toHaveBeenCalledWith(null);
  expect(fireEvent.keyDown(select, { key: "Tab" })).toBe(true);
  fireEvent.keyDown(select, { key: "Escape" });
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();

  fireEvent.click(trigger);
  fireEvent.keyDown(screen.getByRole("menuitem", { name: /下一未标注/ }), { key: "Enter" });
  expect(onSmartNextOpen).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

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

    for (const label of ["上一个任务", "下一个任务"]) {
      const navigation = screen.getByRole("button", { name: label });
      expect(navigation).toHaveAttribute("title", label);
      expect(navigation.textContent).toBe("");
      expect(navigation.querySelector("svg")).not.toBeNull();
    }
    expect(screen.getByTestId("workbench-submit")).toHaveTextContent(/^提交$/);

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

it("keeps the guide slot beside the desktop settings controls", () => {
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
      onOpenWorkbenchSettings={vi.fn()}
      guideSlot={<button aria-label="标注指引">指南</button>}
    />,
  );

  const guide = screen.getByRole("button", { name: "标注指引" });
  const settings = screen.getByRole("button", { name: "工作台设置" });
  expect(guide.parentElement?.parentElement).toBe(settings.parentElement?.parentElement);
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
