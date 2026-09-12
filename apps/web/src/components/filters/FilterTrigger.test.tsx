import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FilterTrigger } from "./FilterTrigger";

describe("FilterTrigger", () => {
  it("uses the canonical funnel, explicit size, and an accessible condition count", () => {
    const ref = createRef<HTMLButtonElement>();
    render(<FilterTrigger ref={ref} count={2} countLabel="附加筛选条件" />);
    const button = screen.getByRole("button", { name: "筛选" });
    expect(button).toHaveAccessibleDescription("2 项附加筛选条件");
    expect(button.querySelector("svg")).toHaveClass("lucide-funnel", "size-4");
    expect(button).toHaveAttribute("data-active", "true");
    expect(ref.current).toBe(button);
  });

  it("does not render a zero badge and forwards controlled trigger props", async () => {
    const click = vi.fn();
    const { rerender } = render(<FilterTrigger count={0} compact onClick={click} aria-expanded />);
    const button = screen.getByRole("button", { name: "筛选" });
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button.querySelector("svg")).toHaveClass("size-3");
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    await userEvent.click(button);
    expect(click).toHaveBeenCalledOnce();
    rerender(<FilterTrigger disabled onClick={click} />);
    await userEvent.click(button);
    expect(click).toHaveBeenCalledOnce();
  });
});
