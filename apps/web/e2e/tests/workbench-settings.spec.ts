import { test, expect } from "../fixtures/seed";

test("图像设置：外部关闭保存、搜索、焦点隔离及响应式布局", async ({ page, seed }, info) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const data = await seed.reset();
  await seed.injectToken(page, data.admin_email);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/projects/${data.project_id}/annotate?task=${data.task_ids[0]}`);
  const trigger = page.getByRole("button", { name: "工作台设置", exact: true });
  const boxTool = page.getByTestId("tool-btn-box");
  await expect(boxTool).toBeVisible();
  await boxTool.click();
  await trigger.click();
  const dialog = page.getByTestId("workbench-settings-dialog");
  const search = dialog.getByRole("textbox", { name: "搜索设置" });
  await expect(dialog.getByTestId("setting-field-common.leftWidthPct")).toBeVisible();
  const imageTab = dialog.getByRole("tab", { name: "图片", exact: true });
  await expect(imageTab).toBeInViewport();
  expect((await imageTab.boundingBox())!.height).toBeLessThanOrEqual(44);
  const labelTabs = dialog.getByRole("tablist", { name: "标签类型" });
  const firstSegment = await labelTabs
    .getByRole("tab", { name: "单帧", exact: true })
    .boundingBox();
  const secondSegment = await labelTabs
    .getByRole("tab", { name: "轨迹", exact: true })
    .boundingBox();
  expect(firstSegment!.y).toBe(secondSegment!.y);
  await page.screenshot({ path: info.outputPath("settings-desktop.png"), animations: "disabled" });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.screenshot({ path: info.outputPath("settings-dark.png"), animations: "disabled" });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));

  // 搜索结果跨当前任务可用分类；父开关随匹配的子项出现。
  await search.fill("邻帧");
  await expect(dialog.getByTestId("setting-field-common.crossFrameOverlayEnabled")).toBeVisible();
  await search.fill("CSS");
  const filter = dialog.getByTestId("setting-field-image.cssImageFilter").getByRole("textbox");
  await filter.fill("brightness(1.15)");
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/auth/me/preferences") && response.request().method() === "PATCH",
  );
  await page.mouse.click(12, 450);
  await expect(dialog).toBeHidden();
  expect((await saved).ok()).toBe(true);
  await expect(trigger).toBeFocused();
  await expect(boxTool).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  await boxTool.click();
  await trigger.click();
  await dialog.getByRole("tab", { name: "图片", exact: true }).click();
  await expect(filter).toHaveValue("brightness(1.15)");
  await dialog.focus();
  await page.keyboard.press("v");
  await page.keyboard.press("Delete");
  await expect(boxTool).toHaveAttribute("aria-pressed", "true");

  // 原生下拉菜单先消费 Esc，第二次 Esc 才关闭设置窗口。
  const select = dialog.getByTestId("setting-field-image.zoomStepFactor").getByRole("combobox");
  await select.click();
  await expect.poll(() => select.evaluate((element) => element.matches(":open"))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveAttribute("data-state", "open");
  await expect.poll(() => select.evaluate((element) => element.matches(":open"))).toBe(false);
  await expect(select).toBeFocused();

  const slider = dialog.getByTestId("setting-field-image.controlPointsSize").getByRole("slider");
  await slider.scrollIntoViewIfNeeded();
  const bounds = await slider.boundingBox();
  if (!bounds) throw new Error("设置滑块不可见");
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(12, 450, { steps: 5 });
  await page.mouse.up();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // 四周都可关闭，点击不能穿透到背景任务导航或工具栏。
  for (const [x, y] of [
    [12, 450],
    [1428, 450],
    [720, 12],
    [720, 888],
  ]) {
    await trigger.click();
    await page.mouse.click(x, y);
    await expect(dialog).toBeHidden();
  }
  await trigger.click();
  await dialog.getByRole("button", { name: "返回工作台" }).focus();
  await page.keyboard.press("Shift+Tab");
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  for (const [width, height] of [
    [1280, 800],
    [1920, 1080],
    [375, 812],
    [320, 812],
  ]) {
    await page.setViewportSize({ width, height });
    await expect
      .poll(() => dialog.evaluate((element) => element.scrollWidth <= element.clientWidth))
      .toBe(true);
    await expect(dialog.getByRole("button", { name: "关闭设置" })).toBeInViewport();
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(dialog).toBeVisible();
  await expect
    .poll(() => dialog.evaluate((element) => element.scrollWidth <= element.clientWidth))
    .toBe(true);
  await page.screenshot({ path: info.outputPath("settings-mobile.png"), animations: "disabled" });
  await dialog.getByRole("button", { name: "返回工作台" }).click();
  await expect(dialog).toBeHidden();
  expect(errors).toEqual([]);
});

test("视频设置：开窗暂停，设置键盘和滚轮不切帧", async ({ page, seed }) => {
  const data = await seed.reset();
  const video = await seed.videoTask(data.project_id);
  await seed.injectToken(page, data.admin_email);
  await page.goto(`/projects/${data.project_id}/annotate?task=${video.task_id}`);
  const source = page.getByTestId("video-konva-source");
  await expect
    .poll(() => source.evaluate((element: HTMLVideoElement) => element.readyState))
    .toBeGreaterThan(1);
  await page.getByRole("button", { name: "播放 / 暂停", exact: true }).click();
  await expect
    .poll(() => source.evaluate((element: HTMLVideoElement) => element.paused))
    .toBe(false);
  await page.getByRole("button", { name: "工作台设置", exact: true }).click();
  await expect
    .poll(() => source.evaluate((element: HTMLVideoElement) => element.paused))
    .toBe(true);
  const frame = await page.getByTestId("video-konva-stage").getAttribute("data-video-frame-index");
  const dialog = page.getByTestId("workbench-settings-dialog");
  await dialog.getByRole("tab", { name: "视频", exact: true }).click();
  await expect(dialog.getByTestId("setting-field-ui.secondary_bar_hidden")).toHaveCount(0);
  const step = dialog.getByTestId("setting-field-video.largeFrameStep").getByRole("combobox");
  await step.focus();
  await page.keyboard.press("ArrowRight");
  await dialog.focus();
  await page.keyboard.press("Space");
  await step.hover();
  await page.mouse.wheel(0, 300);
  await expect(page.getByTestId("video-konva-stage")).toHaveAttribute(
    "data-video-frame-index",
    frame!,
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect
    .poll(() => source.evaluate((element: HTMLVideoElement) => element.paused))
    .toBe(true);
});
