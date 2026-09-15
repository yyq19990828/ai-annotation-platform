/**
 * WhatsNewDialog 单测:
 * - 登录瞬间自动弹出(刷新恢复会话不弹) / 「知道了」写入已读版本 / 关闭=下次登录再提醒
 * - 顶栏版本号手动打开:与已读状态无关,随时可看
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MeResponse, UserPreferences } from "@/api/auth";
import { useAuthStore } from "@/stores/authStore";

const mockUpdatePreferences = vi.fn();
vi.mock("@/api/auth", () => ({
  authApi: {
    updatePreferences: (...args: unknown[]) => mockUpdatePreferences(...args),
  },
}));

vi.mock("@/utils/releaseNotes", () => ({
  appVersion: "2.0.0",
  loadCurrentReleaseNotes: () =>
    Promise.resolve({
      version: "2.0.0",
      date: "2026-02-03",
      groups: [{ key: "Added", label: "新增", items: ["新功能甲"] }],
    }),
  shouldShowReleaseNotes: (seen: string | undefined) => seen !== "2.0.0",
}));

import { WhatsNewDialog, useWhatsNewStore } from "./WhatsNewDialog";

function signIn(preferences?: MeResponse["preferences"]) {
  useAuthStore
    .getState()
    .setAuth("whats-new-token", { id: "u1", role: "annotator", preferences } as MeResponse);
}

const savedPreferences = {
  ui: { theme: "system", secondary_bar_hidden: false, changelog_seen_version: "2.0.0" },
} as UserPreferences;

describe("WhatsNewDialog", () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({ token: null, user: null });
    useWhatsNewStore.setState({ manualOpen: false });
    mockUpdatePreferences.mockReset();
    mockUpdatePreferences.mockResolvedValue(savedPreferences);
  });

  it("登录瞬间(user 从无到有)→ 自动弹出并展示要点;「知道了」写入已读版本", async () => {
    render(<WhatsNewDialog />); // 挂载时未登录(登录页场景)
    act(() => signIn({ ui: { changelog_seen_version: "" } }));

    expect(await screen.findByText("v2.0.0")).toBeTruthy();
    expect(screen.getByText("新功能甲")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "知道了" }));
    await waitFor(() =>
      expect(mockUpdatePreferences).toHaveBeenCalledWith({
        ui: { changelog_seen_version: "2.0.0" },
      }),
    );
    await waitFor(() =>
      expect(useAuthStore.getState().user?.preferences?.ui?.changelog_seen_version).toBe("2.0.0"),
    );
  });

  it("刷新恢复会话(挂载时已登录)→ 不自动弹出;下次真正登录再弹", async () => {
    signIn({ ui: { changelog_seen_version: "" } });
    render(<WhatsNewDialog />);
    expect(screen.queryByText("v2.0.0")).toBeNull();

    // 登出 → 再登录:仍未确认当前版本,重新弹出。
    act(() => useAuthStore.getState().logout());
    act(() => signIn({ ui: { changelog_seen_version: "" } }));
    expect(await screen.findByText(/v2.0.0/)).toBeTruthy();
  });

  it("已确认过当前版本 → 登录也不弹", () => {
    render(<WhatsNewDialog />);
    act(() => signIn({ ui: { changelog_seen_version: "2.0.0" } }));
    expect(screen.queryByText("v2.0.0")).toBeNull();
    expect(mockUpdatePreferences).not.toHaveBeenCalled();
  });

  it("直接关闭(X)→ 不写入;本次登录不再自动弹,下次登录再提醒", async () => {
    render(<WhatsNewDialog />);
    act(() => signIn({ ui: { changelog_seen_version: "" } }));
    await screen.findByText(/v2.0.0/);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByText("v2.0.0")).toBeNull());
    expect(mockUpdatePreferences).not.toHaveBeenCalled();

    // 同一登录态内 user 对象被重取替换(如主题同步 setUser)→ 不再自动弹。
    act(() =>
      useAuthStore.getState().setUser({
        id: "u1",
        role: "annotator",
        preferences: { ui: { changelog_seen_version: "" } },
      } as MeResponse),
    );
    expect(screen.queryByText("v2.0.0")).toBeNull();
  });

  it("确认写入失败 → 本地保持未读(下次登录再提醒),弹窗仍正常关闭", async () => {
    mockUpdatePreferences.mockRejectedValue(new Error("network"));
    render(<WhatsNewDialog />);
    act(() => signIn({ ui: { changelog_seen_version: "" } }));
    await screen.findByText(/v2.0.0/);

    fireEvent.click(screen.getByRole("button", { name: "知道了" }));
    await waitFor(() => expect(mockUpdatePreferences).toHaveBeenCalled());
    await waitFor(() =>
      expect(useAuthStore.getState().user?.preferences?.ui?.changelog_seen_version ?? "").toBe(""),
    );
  });

  it("StrictMode 双调用 effect(回归:登录路径弹窗不被吞)→ 弹窗正常打开", async () => {
    // app 全局开 React.StrictMode,dev 下 mount effect 走 setup-cleanup-setup;
    // 曾因 shownRef 提前登记 + cleanup 使加载失效导致弹窗永不打开。
    render(
      <React.StrictMode>
        <WhatsNewDialog />
      </React.StrictMode>,
    );
    act(() => signIn({ ui: { changelog_seen_version: "" } }));
    expect(await screen.findByText(/v2.0.0/)).toBeTruthy();
    expect(mockUpdatePreferences).not.toHaveBeenCalled();
  });

  it("顶栏版本号手动打开 → 与已读状态无关随时可看;「知道了」同样写入已读", async () => {
    signIn({ ui: { changelog_seen_version: "2.0.0" } });
    render(<WhatsNewDialog />);

    act(() => useWhatsNewStore.getState().openManually());
    expect(await screen.findByText(/v2.0.0/)).toBeTruthy();
    expect(screen.getByText("新功能甲")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "知道了" }));
    await waitFor(() =>
      expect(useAuthStore.getState().user?.preferences?.ui?.changelog_seen_version).toBe("2.0.0"),
    );
  });
});
