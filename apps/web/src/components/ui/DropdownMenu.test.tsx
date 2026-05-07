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

  // v0.9.3 · content 模式
  it("content 模式：渲染自定义内容并支持 close 主动关闭", () => {
    function ContentWrapper() {
      return (
        <DropdownMenu
          trigger={({ toggle, ref }) => (
            <button ref={ref} onClick={toggle}>
              打开
            </button>
          )}
          content={({ close }) => (
            <div>
              <span>自定义表单</span>
              <button onClick={close}>关闭</button>
            </div>
          )}
        />
      );
    }
    render(<ContentWrapper />);
    expect(screen.queryByText("自定义表单")).toBeNull();
    fireEvent.click(screen.getByText("打开"));
    expect(screen.getByText("自定义表单")).toBeInTheDocument();
    fireEvent.click(screen.getByText("关闭"));
    expect(screen.queryByText("自定义表单")).toBeNull();
  });

  it("content 模式：Escape 关闭", () => {
    render(
      <DropdownMenu
        trigger={({ toggle, ref }) => (
          <button ref={ref} onClick={toggle}>
            打开
          </button>
        )}
        content={() => <span>自定义表单</span>}
      />,
    );
    fireEvent.click(screen.getByText("打开"));
    expect(screen.getByText("自定义表单")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("自定义表单")).toBeNull();
  });
});
