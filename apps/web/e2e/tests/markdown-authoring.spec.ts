import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { test, expect, type SeedAPI } from "../fixtures/seed";

const API = `${process.env.PLAYWRIGHT_API_BASE ?? "http://127.0.0.1:8010"}/api/v1`;
const PNG = readFileSync(new URL("../fixtures/markdown-example.png", import.meta.url));
const originalGuide = [
  "# 标注边界说明",
  "",
  "保留这一段 **原始格式**。",
  "",
  "| 类别 | 边界 |",
  "| --- | ---: |",
  "| 车辆 | 贴合可见轮廓 |",
  "",
  "> 遮挡部分按项目约定处理。",
  "",
  "- [ ] 核对类别",
  "- [x] 阅读说明",
  "",
  "2. 核对边界",
  "3. 提交复核",
  "",
  "- 外层说明",
  "  - 嵌套说明",
  "",
  "```text",
  "日志 <frame> {index: 3}",
  "```",
  "",
].join("\n");

async function prepareGuide(
  page: Page,
  request: APIRequestContext,
  seed: SeedAPI,
  content = originalGuide,
) {
  const data = await seed.reset();
  const token = await seed.accessToken(data.admin_email);
  const headers = { Authorization: `Bearer ${token}` };
  const url = `${API}/projects/${data.project_id}`;
  const response = await request.patch(url, { headers, data: { annotation_guide: content } });
  expect(response.ok(), await response.text()).toBe(true);
  await seed.injectToken(page, data.admin_email);
  return {
    ...data,
    headers,
    url,
    async read() {
      const result = await request.get(url, { headers });
      expect(result.ok()).toBe(true);
      return result.json() as Promise<{
        annotation_guide: string;
        guide_assets: Array<{ key: string; original_name: string }>;
      }>;
    },
  };
}

async function openGuide(page: Page, projectId: string) {
  await page.goto(`/projects/${projectId}/settings?section=annotation-guide`);
  const editor = page.getByTestId("markdown-editor");
  await expect(editor).toBeVisible({ timeout: 30_000 });
  return editor;
}

async function mode(editor: Locator, label: "编辑" | "源码" | "预览") {
  const control = editor
    .locator("button, [role=tab]")
    .filter({ hasText: new RegExp(`^${label}$`) });
  await expect(control).toHaveCount(1);
  await control.click();
}

function richText(editor: Locator) {
  return editor.locator('.mdxeditor-contenteditable-wrapper > [contenteditable="true"]').first();
}

async function transferImages(target: Locator, names: string[], kind: "paste" | "drop") {
  await target.focus();
  await target.evaluate(
    (element, payload) => {
      const transfer = new DataTransfer();
      for (const name of payload.names) {
        transfer.items.add(new File([new Uint8Array(payload.bytes)], name, { type: "image/png" }));
      }
      const event =
        payload.kind === "paste"
          ? new ClipboardEvent("paste", {
              bubbles: true,
              cancelable: true,
              clipboardData: transfer,
            })
          : new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer });
      element.dispatchEvent(event);
    },
    { bytes: Array.from(PNG), names, kind },
  );
}

async function pasteImages(target: Locator, names: string[]) {
  await transferImages(target, names, "paste");
}

async function pasteImage(target: Locator, name: string) {
  await pasteImages(target, [name]);
}

test.describe("shared Markdown authoring", () => {
  test.setTimeout(90_000);

  test("opening, previewing and source switching preserve the original guide without a write", async ({
    page,
    request,
    seed,
  }, testInfo) => {
    const fixture = await prepareGuide(page, request, seed);
    const writes: string[] = [];
    page.on("request", (req) => {
      if (
        req.method() === "PATCH" &&
        new URL(req.url()).pathname.endsWith(`/projects/${fixture.project_id}`)
      ) {
        writes.push(req.postData() ?? "");
      }
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const editor = await openGuide(page, fixture.project_id);
    await expect(editor.getByRole("heading", { name: "标注边界说明" })).toBeVisible();
    await expect(richText(editor).locator("ol").first()).toHaveCSS("list-style-type", "decimal");
    expect(
      await editor
        .getByRole("heading", { name: "标注边界说明" })
        .evaluate((heading) => parseFloat(getComputedStyle(heading).fontSize)),
    ).toBeGreaterThan(16);
    await mode(editor, "源码");
    await expect(editor.locator(".cm-content:visible")).toContainText("# 标注边界说明");
    await mode(editor, "预览");
    await expect(editor.getByRole("table")).toBeVisible();
    await expect(editor.getByRole("cell", { name: "贴合可见轮廓" })).toHaveCSS(
      "text-align",
      "right",
    );
    await expect(editor.getByRole("heading", { name: "标注边界说明" })).toBeVisible();
    await expect(editor.locator("ol:visible")).toHaveCSS("list-style-type", "decimal");
    await expect(editor.locator("ol:visible")).toHaveAttribute("start", "2");
    await expect(editor.locator("ul:visible").filter({ hasText: "外层说明" }).first()).toHaveCSS(
      "list-style-type",
      "disc",
    );
    await page.screenshot({
      path: testInfo.outputPath("markdown-reading-light.png"),
      fullPage: true,
    });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await page.screenshot({
      path: testInfo.outputPath("markdown-reading-dark.png"),
      fullPage: true,
    });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    await mode(editor, "编辑");
    await richText(editor).focus();
    await richText(editor).press("Control+Home");
    await richText(editor).press("End");
    await richText(editor).press("a");
    await richText(editor).press("Control+z");
    await page.getByRole("heading", { name: "标注指引", exact: true }).click();
    expect((await fixture.read()).annotation_guide).toBe(originalGuide);
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("guide editing and pasted image upload persist Markdown and survive reload", async ({
    page,
    request,
    seed,
  }, testInfo) => {
    const fixture = await prepareGuide(page, request, seed, "旧说明");
    let editor = await openGuide(page, fixture.project_id);
    const body = richText(editor);
    await body.fill("中文边界说明：沿可见边缘绘制，保留遮挡记录。");
    await body.press("End");
    await body.press("Enter");
    let releaseUpload!: () => void;
    const uploadGate = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
    let firstUploadReady!: () => void;
    const firstUploadGate = new Promise<void>((resolve) => {
      firstUploadReady = resolve;
    });
    let heldUpload = false;
    await page.route("**/guide-assets/upload-complete", async (route) => {
      if (heldUpload) return route.continue();
      heldUpload = true;
      const response = await route.fetch();
      firstUploadReady();
      await uploadGate;
      return route.fulfill({ response });
    });
    const upload = page.waitForResponse(
      (response) =>
        response.url().includes("/guide-assets/upload-complete") &&
        response.request().method() === "POST" &&
        response.request().postDataJSON().original_name === "标注反例.png",
    );
    try {
      await pasteImages(body, ["标注边界示例.png", "标注反例.png"]);
      await firstUploadGate;
      await body.press("Control+Home");
      await body.press("End");
      await page.keyboard.insertText("上传期间继续编辑。");
    } finally {
      releaseUpload();
    }
    expect((await upload).ok()).toBe(true);
    await expect(editor.getByRole("img", { name: "标注边界示例.png" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(editor.getByRole("img", { name: "标注反例.png" })).toBeVisible();
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect
      .poll(async () => (await fixture.read()).annotation_guide)
      .toContain("guide-asset:");
    const saved = await fixture.read();
    expect(saved.annotation_guide).toContain("中文边界说明");
    expect(saved.annotation_guide).toContain("上传期间继续编辑");
    expect(saved.annotation_guide).not.toMatch(
      /X-Amz|AWSAccessKeyId|blob:|data:image|markdown-upload-pending:/,
    );
    expect(saved.guide_assets).toHaveLength(2);
    expect(saved.annotation_guide.indexOf("标注边界示例")).toBeLessThan(
      saved.annotation_guide.indexOf("标注反例"),
    );
    await page.reload();
    editor = page.getByTestId("markdown-editor");
    await expect(editor.getByRole("img", { name: "标注边界示例.png" })).toBeVisible({
      timeout: 30_000,
    });
    await mode(editor, "预览");
    const image = editor.getByRole("img", { name: "标注边界示例.png" });
    await expect(image).toBeVisible();
    await expect
      .poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    await page.screenshot({ path: testInfo.outputPath("guide-light.png"), fullPage: true });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await page.screenshot({ path: testInfo.outputPath("guide-dark.png"), fullPage: true });
  });

  test("a failed guide save retains the draft for an explicit retry", async ({
    page,
    request,
    seed,
  }) => {
    const fixture = await prepareGuide(page, request, seed, "已保存的说明");
    const editor = await openGuide(page, fixture.project_id);
    let failures = 0;
    await page.route(`**/api/v1/projects/${fixture.project_id}`, (route) => {
      if (route.request().method() === "PATCH" && failures++ === 0) {
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: '{"detail":"test save unavailable"}',
        });
      }
      return route.continue();
    });
    await richText(editor).fill("保存失败后应保留的中文草稿");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByText("保存失败", { exact: false }).first()).toBeVisible();
    expect((await fixture.read()).annotation_guide).toBe("已保存的说明");
    await expect(richText(editor)).toContainText("保存失败后应保留的中文草稿");
    await page.getByRole("button", { name: /重试/ }).first().click();
    await expect
      .poll(async () => (await fixture.read()).annotation_guide)
      .toContain("保存失败后应保留的中文草稿");
  });

  test("a failed image upload preserves surrounding edits and can be retried", async ({
    page,
    request,
    seed,
  }) => {
    const fixture = await prepareGuide(page, request, seed, "上传前的边界规则\n\n尾段规则");
    const editor = await openGuide(page, fixture.project_id);
    const body = richText(editor);
    let rejectFirstUpload = true;
    await page.route("**/guide-assets/upload-init", (route) => {
      if (rejectFirstUpload) {
        rejectFirstUpload = false;
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: '{"detail":"test upload unavailable"}',
        });
      }
      return route.continue();
    });
    await body.focus();
    await body.press("Control+Home");
    await body.press("End");
    await body.press("Enter");
    await transferImages(body, ["上传重试示例.png"], "drop");
    await expect(editor.getByTestId("markdown-upload-errors")).toBeVisible();
    await expect(body).toContainText("上传前的边界规则");
    await body.press("Control+Home");
    await body.press("End");
    await page.keyboard.insertText("失败后继续补充。");
    await editor
      .getByTestId("markdown-upload-errors")
      .getByRole("button", { name: "重试", exact: true })
      .click();
    await expect(editor.getByRole("img", { name: "上传重试示例.png" })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect
      .poll(async () => (await fixture.read()).annotation_guide)
      .toContain("guide-asset:");
    const saved = await fixture.read();
    expect(saved.annotation_guide).toContain("上传前的边界规则");
    expect(saved.annotation_guide).toContain("失败后继续补充");
    expect(saved.annotation_guide.indexOf("上传重试示例")).toBeLessThan(
      saved.annotation_guide.indexOf("尾段规则"),
    );
    expect(saved.annotation_guide).not.toMatch(
      /markdown-upload-pending:|上传失败|<!--|blob:|data:image/,
    );
    expect(saved.guide_assets).toHaveLength(1);
  });

  test("editing back to the original while a save is pending cannot leave a stale saved value", async ({
    page,
    request,
    seed,
  }) => {
    const fixture = await prepareGuide(page, request, seed, "初始规则 A");
    const editor = await openGuide(page, fixture.project_id);
    let releaseResponse!: () => void;
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    let firstStored!: () => void;
    const firstStoredGate = new Promise<void>((resolve) => {
      firstStored = resolve;
    });
    let held = false;
    await page.route(`**/api/v1/projects/${fixture.project_id}`, async (route) => {
      if (route.request().method() !== "PATCH" || held) return route.continue();
      held = true;
      const response = await route.fetch();
      firstStored();
      await responseGate;
      return route.fulfill({ response });
    });
    try {
      await richText(editor).fill("编辑中的规则 B");
      await page.getByRole("button", { name: "保存", exact: true }).click();
      await firstStoredGate;
      expect((await fixture.read()).annotation_guide).toContain("编辑中的规则 B");
      await richText(editor).fill("初始规则 A");
      await page.getByRole("heading", { name: "标注指引", exact: true }).click();
      releaseResponse();
      await expect.poll(async () => (await fixture.read()).annotation_guide).toBe("初始规则 A");
      await expect(richText(editor)).toHaveText("初始规则 A");
    } finally {
      releaseResponse();
    }
  });

  test("unsupported legacy markup stays recoverable as source and never executes", async ({
    page,
    request,
    seed,
  }) => {
    const legacy =
      '# 旧指引\n\n<div>旧格式正文</div>\n\n<img src="x" onerror="window.markdownUnexpectedExecution = true">\n\n[链接](javascript:alert(1))\n';
    const fixture = await prepareGuide(page, request, seed, legacy);
    const editor = await openGuide(page, fixture.project_id);
    await mode(editor, "源码");
    await expect(editor.locator(".cm-content:visible")).toContainText("<div>旧格式正文</div>");
    await mode(editor, "预览");
    await expect(editor.locator('a[href^="javascript:"]')).toHaveCount(0);
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { markdownUnexpectedExecution?: boolean })
            .markdownUnexpectedExecution,
      ),
    ).toBeUndefined();
    expect((await fixture.read()).annotation_guide).toBe(legacy);
  });

  test("Chinese IME composition commits its final text once", async ({ page, request, seed }) => {
    const fixture = await prepareGuide(page, request, seed, "中文组合：");
    const editor = await openGuide(page, fixture.project_id);
    const body = richText(editor);
    await body.focus();
    await body.press("Control+End");
    await body.evaluate((element) => {
      const events: string[] = [];
      (window as unknown as { markdownCompositionEvents: string[] }).markdownCompositionEvents =
        events;
      element.addEventListener("compositionstart", (event) => {
        if (event.isTrusted) events.push("start");
      });
      element.addEventListener("compositionend", () => {
        // Chromium's CDP Input.insertText emits an untrusted compositionend,
        // including on a plain contenteditable. Observe that protocol event;
        // the candidate/input events above still originate in the browser.
        events.push("end");
      });
    });
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send("Input.imeSetComposition", {
        text: "guifan",
        selectionStart: 6,
        selectionEnd: 6,
      });
      await cdp.send("Input.imeSetComposition", {
        text: "规范",
        selectionStart: 2,
        selectionEnd: 2,
      });
      await cdp.send("Input.insertText", { text: "规范" });
    } finally {
      await cdp.detach();
    }
    await expect(body).toHaveText("中文组合：规范");
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { markdownCompositionEvents: string[] }).markdownCompositionEvents,
      ),
    ).toEqual(["start", "end"]);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect
      .poll(async () => (await fixture.read()).annotation_guide)
      .toContain("中文组合：规范");
  });

  test("editing a table cell preserves the table in saved Markdown", async ({
    page,
    request,
    seed,
  }) => {
    const fixture = await prepareGuide(page, request, seed);
    const editor = await openGuide(page, fixture.project_id);
    const cell = editor.getByRole("cell", { name: "贴合可见轮廓", exact: true });
    await cell.click();
    await cell.locator('[contenteditable="true"]').fill("保持轮廓贴合，记录遮挡");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect
      .poll(async () => (await fixture.read()).annotation_guide)
      .toContain("保持轮廓贴合，记录遮挡");
    await page.reload();
    await expect(
      page.getByTestId("markdown-editor").getByRole("cell", { name: "保持轮廓贴合，记录遮挡" }),
    ).toBeVisible();
  });

  test("a 100 KB guide with repeated images stays responsive without repeated signing", async ({
    page,
    request,
    seed,
  }, testInfo) => {
    const fixture = await prepareGuide(page, request, seed);
    const init = await request.post(`${fixture.url}/guide-assets/upload-init`, {
      headers: fixture.headers,
      data: { filename: "性能示例.png", content_type: "image/png", size: PNG.length },
    });
    expect(init.ok()).toBe(true);
    const asset = await init.json();
    expect(
      (
        await request.put(asset.upload_url, { headers: { "Content-Type": "image/png" }, data: PNG })
      ).ok(),
    ).toBe(true);
    expect(
      (
        await request.post(`${fixture.url}/guide-assets/upload-complete`, {
          headers: fixture.headers,
          data: { key: asset.key, original_name: "性能示例.png", content_type: "image/png" },
        })
      ).ok(),
    ).toBe(true);
    let content = "# 长指引编辑验收\n\n";
    const paragraph =
      "边界规则：沿可见轮廓绘制，遇到遮挡时记录遮挡属性，类别不确定时提交复核。".repeat(8);
    while (Buffer.byteLength(content) < 100 * 1024) content += `${paragraph}\n\n`;
    content += Array.from(
      { length: 20 },
      (_, index) => `![性能示例 ${index}](guide-asset:${asset.key})`,
    ).join("\n\n");
    expect(
      (
        await request.patch(fixture.url, {
          headers: fixture.headers,
          data: { annotation_guide: content },
        })
      ).ok(),
    ).toBe(true);
    let signingRequests = 0;
    page.on("request", (req) => {
      if (new URL(req.url()).pathname.endsWith("/guide-assets/sign-url")) signingRequests += 1;
    });
    const editor = await openGuide(page, fixture.project_id);
    const exampleImages = editor.getByRole("img", { name: /^性能示例 \d+$/ });
    await expect(exampleImages).toHaveCount(20);
    await expect
      .poll(() =>
        exampleImages.evaluateAll((images) =>
          images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
        ),
      )
      .toBe(true);
    const signedAtLoad = signingRequests;
    expect(signedAtLoad).toBe(1);
    const body = richText(editor);
    await body.focus();
    await body.press("Control+Home");
    await body.evaluate((element) => {
      const durations: number[] = [];
      (window as unknown as { markdownEditDurations: number[] }).markdownEditDurations = durations;
      let start = 0;
      document.addEventListener(
        "beforeinput",
        (event) => {
          if (element.contains(event.target as Node)) start = performance.now();
        },
        true,
      );
      document.addEventListener(
        "input",
        (event) => {
          if (!element.contains(event.target as Node)) return;
          const began = start;
          requestAnimationFrame(() =>
            requestAnimationFrame(() => durations.push(performance.now() - began)),
          );
        },
        true,
      );
    });
    for (let index = 0; index < 50; index += 1) {
      await body.press("a");
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
    }
    const durations = await page.evaluate(
      () => (window as unknown as { markdownEditDurations: number[] }).markdownEditDurations,
    );
    expect(durations).toHaveLength(50);
    const sorted = [...durations].sort((a, b) => a - b);
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
    const measurement = {
      bytes: Buffer.byteLength(content),
      images: 20,
      edits: 50,
      p95,
      signingRequests,
    };
    console.info("Markdown browser measurement:", JSON.stringify(measurement));
    await testInfo.attach("markdown-input-performance", {
      body: JSON.stringify(measurement),
      contentType: "application/json",
    });
    expect(signingRequests).toBe(signedAtLoad);
    expect(p95).toBeLessThan(100);
  });

  test("template guides use the shared editor and retain Markdown after reopening", async ({
    page,
    request,
    seed,
  }, testInfo) => {
    const data = await seed.reset();
    const headers = { Authorization: `Bearer ${await seed.accessToken(data.admin_email)}` };
    await seed.injectToken(page, data.admin_email);
    await page.goto("/project-templates");
    await page.getByTestId("template-new-btn").click();
    let dialog = page.getByRole("dialog", { name: "新建模板" });
    await dialog.getByPlaceholder("如：道路场景标准模板").fill("Markdown 验收模板");
    const editor = dialog.getByTestId("markdown-editor");
    await expect(richText(editor)).toBeVisible({ timeout: 30_000 });
    await richText(editor).fill("模板边界约定：记录遮挡，保留可见轮廓。");
    await richText(editor).press("Control+a");
    await editor.getByRole("button", { name: "插入链接", exact: true }).click();
    const linkAddress = page.getByRole("textbox", { name: "地址", exact: true });
    await expect(linkAddress).toBeVisible();
    await linkAddress.fill("https://example.com/annotation-guide");
    await expect(linkAddress).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath("template-link-popup.png"), fullPage: true });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await page.screenshot({
      path: testInfo.outputPath("template-link-popup-dark.png"),
      fullPage: true,
    });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    await page.getByRole("button", { name: "保存链接", exact: true }).click();
    await mode(editor, "预览");
    await expect(
      editor.getByRole("link", { name: "模板边界约定：记录遮挡，保留可见轮廓。", exact: true }),
    ).toBeVisible();
    const createdResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.endsWith("/project-templates") &&
        response.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: "创建", exact: true }).click();
    const response = await createdResponse;
    expect(response.ok()).toBe(true);
    const template = await response.json();
    try {
      expect(template.annotation_guide).toContain("模板边界约定");
      expect(template.annotation_guide).toContain("https://example.com/annotation-guide");
      expect(template.annotation_guide).not.toMatch(/blob:|data:image|guide-asset:/);
      await page
        .getByTestId(`template-card-${template.id}`)
        .getByRole("button", { name: "编辑", exact: true })
        .click();
      dialog = page.getByRole("dialog", { name: "编辑模板" });
      await expect(richText(dialog.getByTestId("markdown-editor"))).toContainText("模板边界约定");
    } finally {
      // Templates retain their creator; remove this test-owned record before
      // the shared seed teardown removes its disposable users.
      const removed = await request.delete(`${API}/project-templates/${template.id}`, { headers });
      expect(removed.ok(), await removed.text()).toBe(true);
    }
  });

  test("BUG descriptions and both comment entry points use the shared editor", async ({
    page,
    request,
    seed,
  }, testInfo) => {
    const data = await seed.reset();
    await seed.injectToken(page, data.admin_email);
    await page.goto("/bugs");
    await page.getByTitle("报告 Bug / 提交反馈").click();
    await page.getByRole("button", { name: "提交新反馈" }).click();
    await page.getByPlaceholder("发生了什么问题？").fill("Markdown 验收反馈");
    let editor = page.getByTestId("markdown-editor");
    await expect(richText(editor)).toBeVisible({ timeout: 30_000 });
    await richText(editor).fill("复现步骤：打开标注指引，检查图片与表格。");
    await pasteImage(richText(editor), "反馈截图.png");
    const createdResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.endsWith("/bug_reports") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "提交反馈", exact: true }).click();
    const response = await createdResponse;
    expect(response.ok()).toBe(true);
    const created = await response.json();
    expect(created.description).toContain("复现步骤");
    expect(created.description).not.toMatch(/blob:|data:image|guide-asset:/);
    expect(created.attachments).toHaveLength(1);
    await page.getByText(`${created.display_id}: Markdown 验收反馈`, { exact: true }).click();
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    editor = page.getByTestId("markdown-editor");
    await expect(richText(editor)).toBeVisible();
    await richText(editor).fill("更新复现步骤：图片与表格需要保留，截图仍可访问。");
    const updatedResponse = page.waitForResponse(
      (result) =>
        new URL(result.url()).pathname.endsWith(`/bug_reports/${created.id}`) &&
        result.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: "保存修改", exact: true }).click();
    expect((await updatedResponse).ok()).toBe(true);
    await page.getByText(`${created.display_id}: Markdown 验收反馈`, { exact: true }).click();
    editor = page.getByTestId("markdown-editor");
    await expect(richText(editor)).toBeVisible();
    await richText(editor).fill("补充：窄屏也需要正常显示。");
    const firstComment = page.waitForResponse(
      (result) =>
        result.url().includes(`/bug_reports/${created.id}/comments`) &&
        result.request().method() === "POST",
    );
    await page.getByRole("button", { name: "发送", exact: true }).click();
    expect((await firstComment).ok()).toBe(true);
    await page.reload();
    await page.getByRole("row").filter({ hasText: "Markdown 验收反馈" }).click();
    editor = page.getByTestId("markdown-editor");
    await expect(richText(editor)).toBeVisible();
    await richText(editor).fill("管理员验证：内容与附件均保留。");
    const secondComment = page.waitForResponse(
      (result) =>
        result.url().includes(`/bug_reports/${created.id}/comments`) &&
        result.request().method() === "POST",
    );
    await richText(editor).press("Control+Enter");
    expect((await secondComment).ok()).toBe(true);
    const token = await seed.accessToken(data.admin_email);
    const detailResponse = await request.get(`${API}/bug_reports/${created.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(detailResponse.ok()).toBe(true);
    const detail = await detailResponse.json();
    expect(detail.description).toContain("更新复现步骤");
    expect(detail.attachments).toHaveLength(1);
    expect(detail.comments).toHaveLength(2);
    expect(detail.comments.map((comment: { body: string }) => comment.body).join("\n")).toContain(
      "管理员验证",
    );
    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByTitle("报告 Bug / 提交反馈").click();
    await page.getByRole("button", { name: "提交新反馈" }).click();
    editor = page.locator("[data-bug-drawer]").getByTestId("markdown-editor");
    await expect(richText(editor)).toBeVisible();
    const box = await editor.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(376);
    await page.screenshot({ path: testInfo.outputPath("bug-mobile.png"), fullPage: true });
  });
});
