import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FilterPanel } from "./FilterPanel";
import { FilterTrigger } from "./FilterTrigger";

const viewport = vi.hoisted(() => ({ small: false }));
vi.mock("@/hooks/useMediaQuery", () => ({ useMediaQuery: () => viewport.small }));

function Harness() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  return (
    <>
      <button>页面操作</button>
      <FilterPanel
        open={open}
        onOpenChange={setOpen}
        trigger={<FilterTrigger />}
        title="项目筛选"
        description="应用后生效"
        footer={<button onClick={() => setOpen(false)}>取消</button>}
      >
        <input aria-label="草稿" value={draft} onChange={(event) => setDraft(event.target.value)} />
      </FilterPanel>
    </>
  );
}

beforeEach(() => {
  viewport.small = false;
});
describe("FilterPanel", () => {
  it("opens a named non-modal attached panel and restores focus on Escape", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "筛选" });
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "项目筛选" })).toHaveAttribute(
      "data-filter-panel",
      "popover",
    );
    expect(screen.getByRole("dialog")).toHaveAccessibleDescription("应用后生效");
    expect(
      document.querySelector('[data-testid="modal-overlay"], [data-slot="sheet-overlay"]'),
    ).toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("keeps parent-owned input when switching to the bottom sheet without duplicate forms", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness />);
    await user.click(screen.getByRole("button", { name: "筛选" }));
    await user.type(screen.getByRole("textbox", { name: "草稿" }), "保留输入");
    viewport.small = true;
    rerender(<Harness />);
    expect(screen.getAllByRole("textbox", { name: "草稿" })).toHaveLength(1);
    expect(screen.getByRole("textbox")).toHaveValue("保留输入");
    expect(screen.getByRole("dialog", { name: "项目筛选" })).toHaveAttribute(
      "data-filter-panel",
      "sheet",
    );
    await user.click(screen.getByRole("button", { name: "关闭筛选" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "筛选" })).toHaveFocus();
  });
});
