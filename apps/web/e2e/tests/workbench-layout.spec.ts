import type { Page } from "@playwright/test";
import type {
  PanelId,
  WorkspaceNode,
  WorkspaceSnapshot,
} from "../../src/pages/Workbench/layout/workbenchLayoutSnapshot";
import { expect, test } from "../fixtures/seed";

const DESKTOP = { width: 1440, height: 900 };
const panel = (page: Page, id: string) => page.locator(`[data-workbench-panel="${id}"]`);

async function layoutCommand(page: Page, name: string) {
  await page.getByRole("button", { name: "布局", exact: true }).click();
  const command = page.getByRole("menuitem", { name, exact: true });
  await expect(command).toBeEnabled({ timeout: 20_000 });
  await command.click();
}

async function panelCommand(page: Page, title: string, name: string) {
  await page.getByRole("button", { name: `${title}菜单`, exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}

async function savedSnapshot(page: Page, context: string): Promise<WorkspaceSnapshot | undefined> {
  const token = await page.evaluate(() => localStorage.getItem("token"));
  const response = await page.request.get("/api/v1/auth/me/preferences", {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).workbench.layout.workspace?.contexts[context]?.snapshot;
}

function groupFor(node: WorkspaceNode, id: PanelId): string | undefined {
  if (node.type === "leaf") return node.data.views.includes(id) ? node.data.id : undefined;
  return node.data.map((child) => groupFor(child, id)).find(Boolean);
}

// Ignore floating-point arithmetic noise while retaining subpixel geometry checks.
const preciseSnapshot = (snapshot: WorkspaceSnapshot | undefined) =>
  snapshot &&
  JSON.parse(
    JSON.stringify(snapshot, (_key, value) =>
      typeof value === "number" ? Number(value.toFixed(6)) : value,
    ),
  );

/** Compare actual DOM objects, including the Konva media canvas, after every rearrangement. */
async function rememberCanvas(page: Page, stageId: string) {
  const wrapper = panel(page, "canvas");
  const stage = page.getByTestId(stageId);
  const media = stage.locator(".konvajs-content > canvas").first();
  await expect(media).toBeVisible({ timeout: 20_000 });
  const originalWrapper = await wrapper.elementHandle();
  const originalStage = await stage.elementHandle();
  const originalMedia = await media.elementHandle();
  return async () => {
    await expect(wrapper).toHaveCount(1);
    await expect(stage).toBeVisible();
    expect(await wrapper.evaluate((node, original) => node === original, originalWrapper)).toBe(
      true,
    );
    expect(await stage.evaluate((node, original) => node === original, originalStage)).toBe(true);
    expect(await media.evaluate((node, original) => node === original, originalMedia)).toBe(true);
  };
}

test.use({ viewport: DESKTOP });

test("图片布局预设、面板隐藏和浮动保留画布及未发送讨论草稿，刷新恢复已保存树", async ({
  page,
  seed,
}) => {
  test.setTimeout(90_000);
  const data = await seed.reset();
  await seed.advanceTask({
    taskId: data.task_ids[0],
    toStatus: "pending",
    annotatorEmail: data.annotator_email,
  });
  await seed.injectToken(page, data.annotator_email);
  await page.goto(`/projects/${data.project_id}/annotate?task=${data.task_ids[0]}`);
  await layoutCommand(page, "标准标注布局");
  const sameCanvas = await rememberCanvas(page, "workbench-stage");

  // Create and select a real annotation so the existing annotation-comment editor is enabled.
  await page.getByTestId("tool-btn-box").click();
  const stage = page.getByTestId("workbench-stage");
  const box = await stage.boundingBox();
  if (!box) throw new Error("Image stage has no bounds");
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 8 });
  await page.mouse.up();
  // The default drawing mode keeps a geometry draft until the user picks a class.
  const picker = page.getByTestId("class-picker-popover");
  await expect(picker).toBeVisible();
  const created = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === `/api/v1/tasks/${data.task_ids[0]}/annotations`,
    { timeout: 15_000 },
  );
  await picker.getByText("car", { exact: true }).click();
  expect((await created).ok()).toBe(true);

  const discussion = panel(page, "discussion");
  await page.getByRole("button", { name: "收起浮窗", exact: true }).click();
  await discussion.getByRole("tab", { name: "评论", exact: true }).click();
  const editor = discussion.locator('[contenteditable="true"]');
  await expect(editor).toBeVisible();
  const originalEditor = await editor.elementHandle();
  const draft = "布局调整期间保留的未发送评论";
  await editor.fill(draft);
  const sameDraft = async () => {
    await expect(editor).toHaveText(draft);
    expect(await editor.evaluate((node, original) => node === original, originalEditor)).toBe(true);
  };

  for (const name of ["专注画布布局", "审核协作布局", "标准标注布局"]) {
    await layoutCommand(page, name);
    await sameCanvas();
    await sameDraft();
  }
  await panelCommand(page, "讨论 / Issue", "隐藏面板");
  await expect(discussion).toHaveAttribute("aria-hidden", "true");
  await sameDraft();
  await layoutCommand(page, "讨论 / Issue");
  await expect(discussion).toHaveAttribute("aria-hidden", "false");
  await layoutCommand(page, "讨论 / Issue"); // An already visible entry focuses instead of duplicating/hiding.
  await expect(discussion).toHaveCount(1);
  await expect(discussion).toHaveAttribute("aria-hidden", "false");
  await sameDraft();

  await panelCommand(page, "讨论 / Issue", "浮动面板");
  await expect
    .poll(async () =>
      (await savedSnapshot(page, "annotate:image"))?.layout.floatingGroups?.some((group) =>
        group.data?.views.includes("discussion"),
      ),
    )
    .toBe(true);
  await sameCanvas();
  await sameDraft();
  const floating = page.getByRole("dialog", { name: "讨论 / Issue", exact: true });
  const oldRect = await floating.boundingBox();
  const handle = await floating.locator(".dv-resize-handle-bottomright").boundingBox();
  if (!oldRect || !handle) throw new Error("Floating resize handle has no bounds");
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 80, handle.y + handle.height / 2 + 40, {
    steps: 8,
  });
  await page.mouse.up();
  await expect
    .poll(async () => (await floating.boundingBox())?.width)
    .toBeGreaterThan(oldRect.width + 60);
  await expect
    .poll(
      async () =>
        (await savedSnapshot(page, "annotate:image"))?.layout.floatingGroups?.find((group) =>
          group.data?.views.includes("discussion"),
        )?.position.width,
    )
    .toBeGreaterThan(oldRect.width + 60);
  await panelCommand(page, "讨论 / Issue", "与标注详情合并为标签");
  await sameCanvas();
  await sameDraft();
  await panelCommand(page, "讨论 / Issue", "停靠到底部");
  await expect
    .poll(async () => {
      const snapshot = await savedSnapshot(page, "annotate:image");
      return snapshot && groupFor(snapshot.layout.grid.root, "discussion");
    })
    .toBe("dock-discussion");
  await sameCanvas();
  await sameDraft();

  // Exercise native HTML drag/drop as well as the equivalent accessible menu commands.
  await page.waitForTimeout(650);
  const dragWrites: string[] = [];
  const businessWrites: string[] = [];
  page.on("request", (request) => {
    if (!["POST", "PATCH", "DELETE"].includes(request.method())) return;
    if (
      request.url().includes("/preferences") &&
      request.postDataJSON()?.workbench?.layout?.workspace
    )
      dragWrites.push(request.postData()!);
    if (/\/tasks\/[^/]+(?:\/annotations)?$/.test(new URL(request.url()).pathname))
      businessWrites.push(request.url());
  });
  await page
    .getByRole("tab", { name: "任务队列", exact: true })
    .dragTo(page.getByRole("tab", { name: "类别面板", exact: true }));
  await expect
    .poll(async () => {
      const snapshot = await savedSnapshot(page, "annotate:image");
      return (
        snapshot &&
        groupFor(snapshot.layout.grid.root, "task-queue") ===
          groupFor(snapshot.layout.grid.root, "class-palette")
      );
    })
    .toBe(true);
  await page.waitForTimeout(650);
  expect(dragWrites).toHaveLength(1);
  const beforeRejectedDrop = await savedSnapshot(page, "annotate:image");
  await page.getByRole("tab", { name: "类别面板", exact: true }).dragTo(stage);
  await sameCanvas();
  await page.waitForTimeout(650);
  const afterRejectedDrop = await savedSnapshot(page, "annotate:image");
  for (const id of ["canvas", "task-queue", "class-palette"] as const)
    expect(groupFor(afterRejectedDrop!.layout.grid.root, id)).toBe(
      groupFor(beforeRejectedDrop!.layout.grid.root, id),
    );
  expect(businessWrites).toEqual([]);
  await sameCanvas();
  await sameDraft();

  await page.reload();
  await expect(page.getByTestId("workbench-stage")).toBeVisible({ timeout: 20_000 });
  await expect(discussion).toHaveAttribute("aria-hidden", "false");
  await expect(
    page.getByText("保存的布局无法恢复，请从布局菜单重置。", { exact: true }),
  ).toHaveCount(0);
  expect(
    groupFor((await savedSnapshot(page, "annotate:image"))!.layout.grid.root, "discussion"),
  ).toBe("dock-discussion");
});

test("标准和浮动布局使用日间与夜间语义主题", async ({ page, seed }) => {
  test.setTimeout(90_000);
  const data = await seed.reset();
  await seed.injectToken(page, data.admin_email);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/projects/${data.project_id}/annotate?task=${data.task_ids[0]}`);
  await expect(
    page.getByTestId("workbench-stage").locator(".konvajs-content > canvas").first(),
  ).toBeVisible();
  await expect(page.getByTestId("workbench-stage")).toHaveAttribute("data-image-ready", "true");
  await layoutCommand(page, "标准标注布局");
  await page.mouse.move(0, 0);
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 12_000 });
  const workspace = page.locator("[data-workbench-workspace]");
  for (const floating of [false, true]) {
    if (floating) await panelCommand(page, "讨论 / Issue", "浮动面板");
    for (const theme of ["light", "dark"]) {
      const current = await page.locator("html").getAttribute("data-theme");
      if (current !== theme) await page.getByRole("button", { name: /当前.*切到/ }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(workspace).toHaveScreenshot(
        `workspace-${floating ? "floating" : "standard"}-${theme}.png`,
        {
          animations: "disabled",
          maxDiffPixelRatio: 0.01,
        },
      );
    }
  }
});

test("预设撤销恢复自定义树，后续预设替换撤销点且紧凑模式清除撤销入口", async ({ page, seed }) => {
  test.setTimeout(90_000);
  const data = await seed.reset();
  await seed.injectToken(page, data.admin_email);
  await page.goto(`/projects/${data.project_id}/annotate?task=${data.task_ids[0]}`);
  await layoutCommand(page, "标准标注布局");
  const sameCanvas = await rememberCanvas(page, "workbench-stage");
  await panelCommand(page, "任务队列", "与类别面板合并为标签");
  await panelCommand(page, "标注详情", "隐藏面板");
  await panelCommand(page, "讨论 / Issue", "浮动面板");
  await page.waitForTimeout(650);
  const custom = await savedSnapshot(page, "annotate:image");
  await layoutCommand(page, "审核协作布局");
  await page
    .locator("[data-sonner-toast][data-removed='false']")
    .getByRole("button", { name: "撤销", exact: true })
    .click();
  await expect
    .poll(async () => preciseSnapshot(await savedSnapshot(page, "annotate:image")))
    .toEqual(preciseSnapshot(custom));
  await sameCanvas();

  await layoutCommand(page, "标准标注布局");
  await page.waitForTimeout(650);
  const standard = await savedSnapshot(page, "annotate:image");
  await layoutCommand(page, "审核协作布局");
  await expect(page.locator("[data-sonner-toast][data-removed='false']")).toHaveCount(1);
  await page
    .locator("[data-sonner-toast][data-removed='false']")
    .getByRole("button", { name: "撤销", exact: true })
    .click();
  await expect
    .poll(async () => preciseSnapshot(await savedSnapshot(page, "annotate:image")))
    .toEqual(preciseSnapshot(standard));
  await layoutCommand(page, "审核协作布局");
  await page.waitForTimeout(650);
  const desktop = await savedSnapshot(page, "annotate:image");
  await page.setViewportSize({ width: 1024, height: DESKTOP.height });
  await expect(page.locator("[data-workbench-workspace]")).toHaveAttribute("data-compact", "true");
  await expect(
    page
      .locator("[data-sonner-toast][data-removed='false']")
      .getByRole("button", { name: "撤销", exact: true }),
  ).toHaveCount(0);
  await page.setViewportSize(DESKTOP);
  await sameCanvas();
  await page.waitForTimeout(650);
  expect(await savedSnapshot(page, "annotate:image")).toEqual(desktop);
});

test("视频紧凑布局禁止桌面写入，退出后恢复浮窗与非零帧并保持同一画布和解码元素", async ({
  page,
  seed,
}) => {
  test.setTimeout(90_000);
  const data = await seed.reset();
  const video = await seed.videoTask(data.project_id);
  await seed.injectToken(page, data.admin_email);
  await page.goto(`/projects/${data.project_id}/annotate?task=${video.task_id}`);
  await layoutCommand(page, "标准标注布局");
  const stage = page.getByTestId("video-konva-stage");
  const sameCanvas = await rememberCanvas(page, "video-konva-stage");
  const source = page.getByTestId("video-konva-source");
  const originalSource = await source.elementHandle();
  await expect
    .poll(() => source.evaluate((node) => (node as HTMLVideoElement).readyState), {
      timeout: 20_000,
    })
    .toBeGreaterThanOrEqual(2);
  await stage.click({ position: { x: 12, y: 12 } });
  for (let frame = 1; frame <= 3; frame += 1) {
    await page.keyboard.press("ArrowRight");
    await expect(stage).toHaveAttribute("data-video-frame-index", String(frame));
  }
  await panelCommand(page, "讨论 / Issue", "浮动面板");
  await expect
    .poll(async () =>
      (await savedSnapshot(page, "annotate:video"))?.layout.floatingGroups?.some((group) =>
        group.data?.views.includes("discussion"),
      ),
    )
    .toBe(true);
  // Drain the 300 ms writer before observing the negative compact-mode write contract.
  await page.waitForTimeout(650);
  const before = await savedSnapshot(page, "annotate:video");
  const discussion = panel(page, "discussion");
  const desktopRect = await discussion.boundingBox();
  if (!desktopRect) throw new Error("Floating discussion panel has no bounds");
  const playback = await source.evaluate((node) => ({
    time: (node as HTMLVideoElement).currentTime,
    paused: (node as HTMLVideoElement).paused,
  }));
  const workspaceWrites: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "PATCH" &&
      new URL(request.url()).pathname === "/api/v1/auth/me/preferences" &&
      request.postDataJSON()?.workbench?.layout?.workspace
    ) {
      workspaceWrites.push(request.postData()!);
    }
  });

  await page.setViewportSize({ width: 1024, height: DESKTOP.height });
  await expect(page.locator("[data-workbench-workspace]")).toHaveAttribute("data-compact", "true");
  await page.getByRole("button", { name: "布局", exact: true }).click();
  for (const name of ["标准标注布局", "专注画布布局", "审核协作布局", "重置为标准布局"]) {
    await expect(page.getByRole("menuitem", { name, exact: true })).toBeDisabled();
  }
  await page.getByRole("menuitem", { name: "任务队列", exact: true }).click();
  await expect(panel(page, "task-queue")).toBeVisible();
  await page.getByRole("button", { name: "任务队列菜单", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "浮动面板", exact: true })).toBeDisabled();
  await expect(page.getByRole("menuitem", { name: "停靠到左侧", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await layoutCommand(page, "讨论 / Issue");
  await expect(discussion).toHaveAttribute("aria-hidden", "false");
  await expect(panel(page, "task-queue")).toBeHidden();
  await sameCanvas();
  await page.waitForTimeout(650);
  expect(workspaceWrites).toEqual([]);
  expect(await savedSnapshot(page, "annotate:video")).toEqual(before);

  await page.setViewportSize(DESKTOP);
  await expect(page.locator("[data-workbench-workspace]")).toHaveAttribute("data-compact", "false");
  await expect
    .poll(async () => {
      const restored = await discussion.boundingBox();
      return (
        restored &&
        Math.max(
          ...(["x", "y", "width", "height"] as const).map((key) =>
            Math.abs(restored[key] - desktopRect[key]),
          ),
        )
      );
    })
    .toBeLessThanOrEqual(1);
  await sameCanvas();
  expect(await source.evaluate((node, original) => node === original, originalSource)).toBe(true);
  await expect(stage).toHaveAttribute("data-video-frame-index", "3");
  expect(await source.evaluate((node) => (node as HTMLVideoElement).paused)).toBe(playback.paused);
  expect(await source.evaluate((node) => (node as HTMLVideoElement).currentTime)).toBeCloseTo(
    playback.time,
    3,
  );
  await page.waitForTimeout(650);
  expect(workspaceWrites).toEqual([]);
  expect(await savedSnapshot(page, "annotate:video")).toEqual(before);
});
