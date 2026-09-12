import { act, useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ProjectFilterControl } from "./ProjectFilterControl";
import { EMPTY_FILTERS } from "./dashboardUrlState";

const load = vi.hoisted(() => {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { ready, release, started: vi.fn() };
});
vi.mock("./ProjectFilterPanel", async (importOriginal) => {
  load.started();
  await load.ready;
  return importOriginal();
});
vi.mock("@/hooks/useUsers", () => ({
  useUsers: () => ({ data: [], isLoading: false, isError: false }),
}));
vi.mock("@/hooks/useMediaQuery", () => ({ useMediaQuery: () => false }));
vi.mock("@/stores/authStore", () => ({
  useAuthStore: (selector: (state: { user: null }) => unknown) => selector({ user: null }),
}));

function Harness({ onApply = vi.fn() }) {
  const [open, setOpen] = useState(false);
  return (
    <ProjectFilterControl
      open={open}
      onOpenChange={setOpen}
      initial={EMPTY_FILTERS}
      onApply={onApply}
      count={2}
    />
  );
}

describe("ProjectFilterControl", () => {
  it("defers the panel until first open and retains its trigger through close/reopen", async () => {
    const user = userEvent.setup();
    const apply = vi.fn();
    render(<Harness onApply={apply} />);
    const trigger = screen.getByRole("button", { name: "筛选" });
    expect(trigger).toHaveAccessibleDescription("2 项附加筛选条件（不含状态标签）");
    expect(load.started).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(trigger);
    expect(load.started).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "筛选" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "筛选" })).toHaveAttribute("aria-busy", "true");
    await act(async () => load.release());
    expect(await screen.findByRole("dialog", { name: "高级筛选" })).toHaveAttribute(
      "data-filter-panel",
      "popover",
    );
    const loadedTrigger = screen.getByRole("button", { name: "筛选" });
    await user.click(screen.getByRole("button", { name: "已完成" }));
    await user.keyboard("{Escape}");
    expect(apply).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "筛选" })).toBe(loadedTrigger);
    expect(loadedTrigger).toHaveFocus();
    await user.click(loadedTrigger);
    expect(screen.getByRole("button", { name: "已完成" })).toHaveAttribute("aria-pressed", "false");
    await user.click(screen.getByRole("button", { name: "进行中" }));
    await user.click(screen.getByRole("button", { name: "应用" }));
    expect(apply).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ status: "in_progress" }));
    expect(load.started).toHaveBeenCalledOnce();
  });

  it("opens when controlled by an external condition-summary action", async () => {
    const props = {
      onOpenChange: vi.fn(),
      onApply: vi.fn(),
      count: 0,
      initial: { ...EMPTY_FILTERS, status: "completed" as const },
    };
    const { rerender } = render(<ProjectFilterControl {...props} open={false} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerender(<ProjectFilterControl {...props} open />);
    expect(await screen.findByRole("dialog", { name: "高级筛选" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "已完成" })).toHaveAttribute("aria-pressed", "true");
  });
});
