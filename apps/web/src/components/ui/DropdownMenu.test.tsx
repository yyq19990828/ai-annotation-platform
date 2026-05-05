/**
 * v0.7.6 · DropdownMenu 单测：trigger 触发开关、点击 item 触发 onSelect 并关闭、Escape 关闭。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DropdownMenu, type DropdownItem } from "./DropdownMenu";

function Wrapper({
  items,
  onSelectA,
  onSelectB,
}: {
  items?: DropdownItem[];
  onSelectA?: () => void;
  onSelectB?: () => void;
}) {
  const defaultItems: DropdownItem[] = [
    { id: "a", label: "Option A", onSelect: onSelectA },
    { id: "b", label: "Option B", onSelect: onSelectB },
  ];
  return (
    <DropdownMenu
      items={items ?? defaultItems}
      trigger={({ open, toggle, ref }) => (
        <button ref={ref} onClick={toggle} aria-expanded={open}>
          打开
        </button>
      )}
    />
  );
}

describe("<DropdownMenu />", () => {
  it("初始关闭，点击 trigger 后打开", () => {
    render(<Wrapper />);
    expect(screen.queryByText("Option A")).toBeNull();
    fireEvent.click(screen.getByText("打开"));
    expect(screen.getByText("Option A")).toBeInTheDocument();
    expect(screen.getByText("打开")).toHaveAttribute("aria-expanded", "true");
  });

  it("点击 item 触发 onSelect 并关闭菜单", () => {
    const onSelectA = vi.fn();
    render(<Wrapper onSelectA={onSelectA} />);
    fireEvent.click(screen.getByText("打开"));
    fireEvent.click(screen.getByText("Option A"));
    expect(onSelectA).toHaveBeenCalledTimes(1);
    // 关闭后 item 消失
    expect(screen.queryByText("Option A")).toBeNull();
  });

  it("Escape 关闭打开的菜单", () => {
    render(<Wrapper />);
    fireEvent.click(screen.getByText("打开"));
    expect(screen.getByText("Option A")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("Option A")).toBeNull();
  });

  it("disabled item 点击不触发 onSelect", () => {
    const onSelect = vi.fn();
    render(
      <Wrapper
        items={[
          { id: "x", label: "Disabled", disabled: true, onSelect },
        ]}
      />,
    );
    fireEvent.click(screen.getByText("打开"));
    fireEvent.click(screen.getByText("Disabled"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("divider 项不渲染交互", () => {
    render(
      <Wrapper
        items={[
          { id: "1", label: "One", onSelect: () => {} },
          { id: "div", divider: true, label: "" },
          { id: "2", label: "Two", onSelect: () => {} },
        ]}
      />,
    );
    fireEvent.click(screen.getByText("打开"));
    expect(screen.getByText("One")).toBeInTheDocument();
    expect(screen.getByText("Two")).toBeInTheDocument();
  });
});
