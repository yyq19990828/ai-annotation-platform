// v0.15.3 · 工作台设置抽屉:分组渲染(通用 + 当前模态)、空分组不渲染、锁定禁用、
// 改动经 setFields 提交。useWorkbenchConfig 整体 mock,写路径防抖在 hook 自身单测覆盖。
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WORKBENCH_PREFERENCES } from "@/api/auth";
import type { LockableField } from "../state/useWorkbenchConfig";

const mockSetFields = vi.fn();
const mockLockedFields: { current: LockableField[] } = { current: [] };

vi.mock("../state/useWorkbenchConfig", async () => {
  const actual = await vi.importActual<typeof import("../state/useWorkbenchConfig")>(
    "../state/useWorkbenchConfig",
  );
  return {
    ...actual,
    useWorkbenchConfig: () => ({
      config: DEFAULT_WORKBENCH_PREFERENCES,
      layout: DEFAULT_WORKBENCH_PREFERENCES.layout,
      loaded: true,
      saving: false,
      update: vi.fn(),
      setFields: mockSetFields,
      setLayout: vi.fn(),
      lockedFields: mockLockedFields.current,
    }),
  };
});

import { WorkbenchSettingsDrawer } from "./WorkbenchSettingsDrawer";

function renderDrawer(props?: Partial<Parameters<typeof WorkbenchSettingsDrawer>[0]>) {
  return render(
    <MemoryRouter>
      <WorkbenchSettingsDrawer
        open
        onClose={vi.fn()}
        stageKind="image"
        {...props}
      />
    </MemoryRouter>,
  );
}

describe("WorkbenchSettingsDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLockedFields.current = [];
  });

  it("open=false 不渲染", () => {
    renderDrawer({ open: false });
    expect(screen.queryByTestId("workbench-settings-drawer")).toBeNull();
  });

  it("image 模态:渲染「通用 + 图片」两组,hidden 字段(snapToGrid)不出现", () => {
    renderDrawer();
    expect(screen.getByText("通用")).toBeTruthy();
    expect(screen.getByText("图片")).toBeTruthy();
    expect(screen.getByText(/性能采样率/)).toBeTruthy();
    expect(screen.getByText(/图像平滑/)).toBeTruthy();
    expect(screen.queryByText(/网格吸附/)).toBeNull();
    // 非当前模态组不出现
    expect(screen.queryByText("视频")).toBeNull();
    expect(screen.queryByText("点云")).toBeNull();
  });

  it("3d 模态:点云子树本版为空 → 只渲染「通用」组", () => {
    renderDrawer({ stageKind: "3d" });
    expect(screen.getByText("通用")).toBeTruthy();
    expect(screen.queryByText("点云")).toBeNull();
    expect(screen.queryByText(/图像平滑/)).toBeNull();
  });

  it("改动控件 → setFields 收到子树级 patch", () => {
    renderDrawer();
    const smooth = screen
      .getByTestId("setting-field-image.smoothImage")
      .querySelector("input[type=checkbox]") as HTMLInputElement;
    fireEvent.click(smooth);
    expect(mockSetFields).toHaveBeenCalledWith({ image: { smoothImage: false } });
  });

  it("被项目锁定的字段禁用", () => {
    mockLockedFields.current = ["smoothImage"];
    renderDrawer();
    const smooth = screen
      .getByTestId("setting-field-image.smoothImage")
      .querySelector("input[type=checkbox]") as HTMLInputElement;
    expect(smooth.disabled).toBe(true);
    expect(screen.getByText("项目锁定")).toBeTruthy();
  });

  it("Escape 关闭抽屉", () => {
    const onClose = vi.fn();
    renderDrawer({ onClose });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
