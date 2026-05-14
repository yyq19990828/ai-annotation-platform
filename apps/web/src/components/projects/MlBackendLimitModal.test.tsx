/**
 * v0.10.3 · MlBackendLimitModal 单测 — server message 优先 / fallback / current 计数 / 关闭回调.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MlBackendLimitModal } from "./MlBackendLimitModal";

describe("<MlBackendLimitModal />", () => {
  it("open=false 不渲染", () => {
    render(<MlBackendLimitModal open={false} limit={1} onClose={() => {}} />);
    expect(screen.queryByText(/多后端共存暂未支持/)).toBeNull();
  });

  it("无 serverMessage 时显示 fallback", () => {
    render(<MlBackendLimitModal open limit={1} onClose={() => {}} />);
    expect(screen.getByText(/最多绑定 1 个 ML 后端/)).toBeInTheDocument();
  });

  it("有 serverMessage 时优先服务器文案", () => {
    render(
      <MlBackendLimitModal
        open
        limit={1}
        serverMessage="服务器自定义文案 XYZ"
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("服务器自定义文案 XYZ")).toBeInTheDocument();
    expect(screen.queryByText(/最多绑定 1 个 ML 后端/)).toBeNull();
  });

  it("传入 current 时显示已用计数", () => {
    render(<MlBackendLimitModal open limit={1} current={1} onClose={() => {}} />);
    expect(screen.getByText("当前已绑定 1 / 1")).toBeInTheDocument();
  });

  it("点「我知道了」触发 onClose", () => {
    const onClose = vi.fn();
    render(<MlBackendLimitModal open limit={1} onClose={onClose} />);
    fireEvent.click(screen.getByText("我知道了"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
