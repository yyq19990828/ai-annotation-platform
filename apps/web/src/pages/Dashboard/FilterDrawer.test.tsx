import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EMPTY_FILTERS, FilterDrawer } from "./FilterDrawer";

vi.mock("@/components/ui/Modal", () => ({
  Modal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/hooks/useUsers", () => ({
  useUsers: () => ({ data: [] }),
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: <T,>(selector: (state: { user: null }) => T) => selector({ user: null }),
}));

describe("FilterDrawer", () => {
  it("keeps a draft on Cancel and applies it only after Apply", () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(
      <FilterDrawer open initial={EMPTY_FILTERS} onApply={onApply} onClose={onClose} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "进行中" }));
    expect(screen.getByRole("button", { name: "进行中" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<FilterDrawer open initial={EMPTY_FILTERS} onApply={onApply} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "已完成" }));
    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ status: "completed" }));
  });

  it("rejects a reversed date range before Apply", () => {
    const onApply = vi.fn();
    render(<FilterDrawer open initial={EMPTY_FILTERS} onApply={onApply} onClose={vi.fn()} />);
    expect(screen.getByLabelText("创建开始日期")).toBeInTheDocument();
    expect(screen.getByLabelText("创建结束日期")).toBeInTheDocument();
    const dates = screen.getAllByDisplayValue("");
    const dateInputs = dates.filter((input) => input.getAttribute("type") === "date");
    fireEvent.change(dateInputs[0], { target: { value: "2026-02-01" } });
    fireEvent.change(dateInputs[1], { target: { value: "2026-01-01" } });
    expect(screen.getByRole("alert")).toHaveTextContent("开始日期不能晚于结束日期");
    expect(screen.getByRole("button", { name: "应用" })).toBeDisabled();
    expect(onApply).not.toHaveBeenCalled();
  });
});
