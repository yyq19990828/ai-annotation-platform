import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  pushToast: vi.fn(),
  query: {} as any,
  update: {} as any,
  reset: {} as any,
}));

vi.mock("@/components/ui/Toast", () => ({
  useToastStore: (selector: (state: any) => unknown) => selector({ push: mocks.pushToast }),
}));

vi.mock("@/hooks/useStorageConnections", () => ({
  useConnectorAllowlist: () => mocks.query,
  useUpdateConnectorAllowlist: () => mocks.update,
  useResetConnectorAllowlist: () => mocks.reset,
}));

import { ConnectorAllowlistSettings } from "./ConnectorAllowlistSettings";

describe("ConnectorAllowlistSettings", () => {
  beforeEach(() => {
    mocks.pushToast.mockReset();
    mocks.query = {
      data: { entries: ["10.0.3.0/24"], source: "environment" },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    };
    mocks.update = {
      mutateAsync: vi.fn().mockResolvedValue({
        entries: ["10.0.3.0/24", ".example.com"],
        source: "database",
      }),
      isPending: false,
      error: null,
    };
    mocks.reset = {
      mutateAsync: vi.fn().mockResolvedValue({
        entries: ["9.9.9.0/24"],
        source: "environment",
      }),
      isPending: false,
      error: null,
    };
  });

  it("显示来源，添加并保存规范化后的条目", async () => {
    render(<ConnectorAllowlistSettings />);

    expect(await screen.findByText("部署默认")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("添加条目"), {
      target: { value: ".Example.COM." },
    });
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    expect(screen.getByText(".example.com")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "保存覆盖" }));
    await waitFor(() =>
      expect(mocks.update.mutateAsync).toHaveBeenCalledWith(["10.0.3.0/24", ".example.com"]),
    );
    expect(mocks.pushToast).toHaveBeenCalledWith({
      msg: "连接器主机白名单已保存",
      kind: "success",
    });
  });

  it("客户端拒绝 URL 与重复条目", async () => {
    render(<ConnectorAllowlistSettings />);
    await screen.findByText("10.0.3.0/24");

    const input = screen.getByLabelText("添加条目");
    fireEvent.change(input, { target: { value: "https://example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    expect(screen.getByText(/不要包含 URL scheme/)).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "10.0.3.0/24" } });
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    expect(screen.getByText("该条目已存在")).toBeInTheDocument();
  });

  it("保存空名单前要求二次确认且失败时保留草稿", async () => {
    mocks.update.mutateAsync.mockRejectedValueOnce(new Error("策略校验失败"));
    render(<ConnectorAllowlistSettings />);
    await screen.findByText("10.0.3.0/24");

    fireEvent.click(screen.getByRole("button", { name: "移除 10.0.3.0/24" }));
    fireEvent.click(screen.getByRole("button", { name: "保存覆盖" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("保存空白名单？");
    fireEvent.click(screen.getByRole("button", { name: "确认保存空名单" }));

    await waitFor(() => expect(mocks.update.mutateAsync).toHaveBeenCalledWith([]));
    expect(screen.getByText(/当前为空，保存后/)).toBeInTheDocument();
    expect(mocks.pushToast).toHaveBeenCalledWith({
      msg: "白名单保存失败",
      sub: "策略校验失败",
      kind: "warning",
    });
  });

  it("数据库覆盖可确认恢复部署默认", async () => {
    mocks.query.data = { entries: ["10.0.3.0/24"], source: "database" };
    render(<ConnectorAllowlistSettings />);
    expect(await screen.findByText("数据库覆盖")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "恢复部署默认" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("恢复部署默认白名单？");
    fireEvent.click(screen.getByRole("button", { name: "确认恢复" }));

    await waitFor(() => expect(mocks.reset.mutateAsync).toHaveBeenCalledTimes(1));
    expect(screen.getByText("9.9.9.0/24")).toBeInTheDocument();
  });

  it("读取失败时显示错误并可重试", () => {
    mocks.query = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("读取失败"),
      refetch: vi.fn(),
    };
    render(<ConnectorAllowlistSettings />);

    expect(screen.getByText("无法读取白名单")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(mocks.query.refetch).toHaveBeenCalledTimes(1);
  });
});
