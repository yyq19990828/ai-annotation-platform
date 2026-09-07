import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "./Sidebar";

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    canAccessPage: () => true,
    hasAnyPermission: () => true,
    role: "super_admin",
  }),
}));
vi.mock("@/hooks/useFailedPredictions", () => ({
  useFailedPredictions: () => ({ data: { total: 2 } }),
}));
vi.mock("@/hooks/useDashboard", () => ({
  useAdminStats: () => ({ data: { pre_annotated_batches: 3 } }),
}));
const mount = (drawer = false) =>
  render(
    <MemoryRouter>
      <Sidebar reviewCount={4} drawer={drawer} />
    </MemoryRouter>,
  );
const sidebar = () => screen.getByRole("complementary", { name: "主导航" });
const handle = () => screen.getByRole("separator", { name: "调整侧边栏宽度" });

describe("Sidebar layout", () => {
  beforeEach(() => {
    localStorage.removeItem("anno.sidebar-layout");
  });
  it("restores expanded width after collapsing and remounting; retains named navigation and counts", () => {
    const view = mount();
    fireEvent.keyDown(handle(), { key: "End" });
    fireEvent.click(screen.getByRole("button", { name: "收起侧边栏" }));
    expect(sidebar()).toHaveStyle({ width: "56px" });
    expect(screen.getByRole("link", { name: "质检审核 · 4 待审核" })).toHaveAttribute(
      "title",
      "质检审核 · 4 待审核",
    );
    expect(screen.getByRole("link", { name: "AI 预标注 · 3 待接管 · 2 失败" })).toHaveAttribute(
      "title",
      "AI 预标注 · 3 待接管 · 2 失败",
    );
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    view.unmount();
    mount();
    expect(sidebar()).toHaveStyle({ width: "56px" });
    fireEvent.click(screen.getByRole("button", { name: "展开侧边栏" }));
    expect(sidebar()).toHaveStyle({ width: "320px" });
  });
  it.each([false, true])(
    "exposes review and AI counts in expanded navigation (drawer=%s)",
    (drawer) => {
      mount(drawer);
      expect(screen.getByRole("link", { name: "质检审核 · 4 待审核" })).toBeVisible();
      expect(screen.getByRole("link", { name: "AI 预标注 · 3 待接管 · 2 失败" })).toBeVisible();
    },
  );
  it("clamps keyboard changes and resets width on double click", () => {
    mount();
    fireEvent.keyDown(handle(), { key: "Home" });
    fireEvent.keyDown(handle(), { key: "ArrowLeft" });
    expect(handle()).toHaveAttribute("aria-valuenow", "200");
    fireEvent.keyDown(handle(), { key: "End" });
    fireEvent.keyDown(handle(), { key: "ArrowRight" });
    expect(handle()).toHaveAttribute("aria-valuenow", "320");
    fireEvent.doubleClick(handle());
    expect(sidebar()).toHaveStyle({ width: "220px" });
  });
  it("clamps pointer dragging and stops on cancellation", () => {
    mount();
    const separator = handle();
    separator.setPointerCapture = vi.fn();
    separator.releasePointerCapture = vi.fn();
    const pointer = (type: string, clientX: number) =>
      fireEvent(separator, new MouseEvent(type, { bubbles: true, button: 0, clientX }));
    pointer("pointerdown", 220);
    pointer("pointermove", 900);
    expect(sidebar()).toHaveStyle({ width: "320px" });
    pointer("pointermove", -200);
    expect(sidebar()).toHaveStyle({ width: "200px" });
    pointer("pointercancel", -200);
    pointer("pointermove", 260);
    expect(sidebar()).toHaveStyle({ width: "200px" });
  });
  it("ignores desktop collapse in the mobile drawer", () => {
    localStorage.setItem("anno.sidebar-layout", JSON.stringify({ width: 300, collapsed: true }));
    mount(true);
    expect(sidebar()).toHaveStyle({ width: "100%" });
    expect(screen.queryByRole("button", { name: "展开侧边栏" })).not.toBeInTheDocument();
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "平台概览" })).toBeVisible();
  });
  it.each(["broken", '{"width":"invalid"}', '{"width":null}'])(
    "recovers invalid saved preferences: %s",
    (saved) => {
      localStorage.setItem("anno.sidebar-layout", saved);
      mount();
      expect(sidebar()).toHaveStyle({ width: "220px" });
    },
  );
});
