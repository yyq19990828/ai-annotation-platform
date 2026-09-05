import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WORKBENCH_PREFERENCES } from "@/api/auth";
import { POINT_CLOUD_WEBGPU_STORAGE_KEY } from "../state/workbenchSettingsFields";
import { WorkbenchSettingsDialog } from "./WorkbenchSettingsDialog";

const mocks = vi.hoisted(() => ({
  setFields: vi.fn(),
  retryLoad: vi.fn(),
  loaded: true,
  loadError: null as Error | null,
  lockedFields: [] as string[],
}));
vi.mock("@/hooks/useMediaQuery", () => ({ useMediaQuery: () => true }));
vi.mock("../state/useWorkbenchConfig", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useWorkbenchConfig: () => ({ config: DEFAULT_WORKBENCH_PREFERENCES, ...mocks }),
}));

type Props = Partial<Parameters<typeof WorkbenchSettingsDialog>[0]>;
function mount(props: Props = {}) {
  return render(
    <MemoryRouter>
      <WorkbenchSettingsDialog open onClose={vi.fn()} stageKind="image" {...props} />
    </MemoryRouter>,
  );
}
const category = (name: string) => screen.getByRole("tab", { name });

describe("WorkbenchSettingsDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loaded = true;
    mocks.loadError = null;
    mocks.lockedFields = [];
    localStorage.clear();
  });

  it.each([
    ["image", ["通用", "图片"]],
    ["video", ["通用", "视频", "实验特性"]],
    ["3d", ["通用", "点云", "实验特性"]],
  ] as const)("%s only shows its available categories", (stageKind, expected) => {
    mount({ stageKind });
    expect(
      within(screen.getByRole("tablist", { name: "设置分类" }))
        .getAllByRole("tab")
        .map((tab) => tab.textContent),
    ).toEqual(expected);
    expect(screen.queryByText("网格吸附")).not.toBeInTheDocument();
  });

  it("closed dialog renders nothing", () => {
    mount({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("switches categories, preserves project locks and writes unlocked fields", async () => {
    mocks.lockedFields = ["smoothImage"];
    mount();
    const user = userEvent.setup();
    await user.click(category("图片"));
    const smooth = screen.getByTestId("setting-field-image.smoothImage");
    expect(within(smooth).getByRole("switch")).toBeDisabled();
    expect(within(smooth).getByText("项目锁定")).toBeVisible();
    await user.selectOptions(screen.getByRole("combobox", { name: "画框后行为" }), "reuse_active");
    expect(mocks.setFields).toHaveBeenCalledWith({ image: { afterBoxCreate: "reuse_active" } });
  });

  it("search spans categories, keeps the disabled child's parent, and clears on category click", async () => {
    mount({ stageKind: "3d" });
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "搜索设置" }), "上色 Gamma");
    expect(screen.getByTestId("setting-field-pointcloud.colorizeWithCamera")).toBeVisible();
    expect(
      within(screen.getByTestId("setting-field-pointcloud.colorizeGamma")).getByRole("slider"),
    ).toBeDisabled();
    expect(screen.queryByTestId("setting-field-pointcloud.colorizeBrightness")).toBeNull();
    await user.click(category("通用"));
    expect(screen.getByRole("textbox", { name: "搜索设置" })).toHaveValue("");
    await user.type(screen.getByRole("textbox", { name: "搜索设置" }), "不存在的设置");
    expect(screen.getByText("没有找到相关设置")).toBeVisible();
  });

  it("writes experiments locally and shows only applicable special settings", async () => {
    const onToggleHideOrphans = vi.fn();
    const onToggleSecondaryBar = vi.fn();
    mount({ stageKind: "3d", onToggleHideOrphans, onToggleSecondaryBar });
    const user = userEvent.setup();
    await user.click(screen.getByRole("switch", { name: "隐藏孤儿标注" }));
    expect(onToggleHideOrphans).toHaveBeenCalledOnce();
    await user.click(category("实验特性"));
    await user.click(screen.getByRole("switch", { name: "3D WebGPU 渲染器" }));
    expect(localStorage.getItem(POINT_CLOUD_WEBGPU_STORAGE_KEY)).toBe("1");
    expect(mocks.setFields).not.toHaveBeenCalled();
    expect(screen.queryByText("二次推理面板")).toBeNull();
  });

  it("image's secondary toggle keeps its independent callback", async () => {
    const onToggleSecondaryBar = vi.fn();
    mount({ onToggleSecondaryBar });
    const user = userEvent.setup();
    await user.click(category("图片"));
    await user.click(screen.getByRole("switch", { name: "二次推理面板" }));
    expect(onToggleSecondaryBar).toHaveBeenCalledOnce();
    expect(mocks.setFields).not.toHaveBeenCalled();
  });

  it("an outside click commits the text, closes and restores focus without reaching the background", async () => {
    const background = vi.fn();
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>打开设置</button>
          <button onClick={background}>画布</button>
          <WorkbenchSettingsDialog open={open} onClose={() => setOpen(false)} stageKind="image" />
        </>
      );
    }
    render(
      <MemoryRouter>
        <Harness />
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    const trigger = screen.getByRole("button", { name: "打开设置" });
    await user.click(trigger);
    await user.click(category("图片"));
    await user.type(screen.getByRole("textbox", { name: "CSS 图像滤镜" }), " invert(1) ");
    await user.click(screen.getByTestId("workbench-settings-overlay"));
    expect(mocks.setFields).toHaveBeenCalledTimes(1);
    expect(mocks.setFields).toHaveBeenCalledWith({ image: { cssImageFilter: "invert(1)" } });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(background).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
  });

  it("Esc commits focused settings but composition and inside-to-outside drag do not close", async () => {
    const onClose = vi.fn();
    mount({ onClose });
    const user = userEvent.setup();
    await user.click(category("图片"));
    const input = screen.getByRole("textbox", { name: "CSS 图像滤镜" });
    await user.type(input, "contrast(1.2)");
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
    expect(mocks.setFields).toHaveBeenCalledWith({ image: { cssImageFilter: "contrast(1.2)" } });
    onClose.mockClear();
    fireEvent.pointerDown(screen.getByRole("slider", { name: "控制点大小" }));
    fireEvent.pointerUp(screen.getByTestId("workbench-settings-overlay"));
    fireEvent.click(screen.getByTestId("workbench-settings-overlay"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps focus in the dialog and commits on category change", async () => {
    mount();
    const user = userEvent.setup();
    await user.click(category("图片"));
    await user.type(screen.getByRole("textbox", { name: "CSS 图像滤镜" }), "brightness(1.1)");
    await user.click(category("通用"));
    expect(mocks.setFields).toHaveBeenCalledTimes(1);
    expect(mocks.setFields).toHaveBeenCalledWith({ image: { cssImageFilter: "brightness(1.1)" } });
    screen.getByRole("button", { name: "关闭设置" }).focus();
    await user.tab();
    expect(screen.getByRole("dialog")).toContainElement(document.activeElement as HTMLElement);
  });

  it("failed loads show retry and no writable defaults", async () => {
    mocks.loadError = new Error("offline");
    mount();
    expect(screen.queryByRole("slider")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(mocks.retryLoad).toHaveBeenCalledOnce();
  });
});
