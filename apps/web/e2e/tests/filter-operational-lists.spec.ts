import type { Page, Response } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { expect, test as base, type FilteringSeedManifest } from "../fixtures/seed";
import { resetFiltering } from "../fixtures/filtering";

const test = base.extend<{ filtering: FilteringSeedManifest }>({
  filtering: async ({ seed, page }, provideFixture) => {
    const data = await resetFiltering(seed);
    await seed.injectToken(page, data.user_emails.admin);
    await provideFixture(data);
  },
});
test.setTimeout(90_000);

function getResponse(page: Page, path: string, params: Record<string, string> = {}) {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === "GET" &&
      url.pathname === "/api/v1" + path &&
      Object.entries(params).every(([key, value]) => url.searchParams.get(key) === value)
    );
  });
}

async function checked(response: Response) {
  expect(response.ok(), response.status() + " " + (await response.text())).toBe(true);
  return response.json();
}

test("project drawer and status tabs share one applied state and cancel keeps it", async ({
  page,
  filtering,
}) => {
  const initial = getResponse(page, "/projects", { search: "Filter Ops" });
  await page.goto("/dashboard?q=Filter+Ops&layout=grid&keep=filter-test");
  const projects = await checked(await initial);
  expect(projects.map((project: { id: string }) => project.id).sort()).toEqual(
    [...filtering.operations.project_ids].sort(),
  );
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "高级筛选" });
  await drawer.getByRole("button", { name: "已完成", exact: true }).click();
  await drawer.getByRole("button", { name: "取消", exact: true }).click();
  expect(new URL(page.url()).searchParams.has("status")).toBe(false);

  await page.getByRole("button", { name: "筛选", exact: true }).click();
  await drawer.getByRole("button", { name: "已完成", exact: true }).click();
  const completed = getResponse(page, "/projects", { status: "completed" });
  await drawer.getByRole("button", { name: "应用", exact: true }).click();
  await checked(await completed);
  await expect.poll(() => new URL(page.url()).searchParams.get("status")).toBe("completed");
  const inProgress = getResponse(page, "/projects", { status: "in_progress" });
  await page.getByRole("button", { name: "进行中", exact: true }).click();
  await checked(await inProgress);
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  await expect(drawer.getByRole("button", { name: "进行中", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await drawer.getByRole("button", { name: "取消", exact: true }).click();
  await page.reload();
  await expect(page.getByPlaceholder("搜索项目...")).toHaveValue("Filter Ops");
  expect(new URL(page.url()).searchParams.get("keep")).toBe("filter-test");
});

test("members restore filters, clear selection on filter changes, and isolate invitation keys", async ({
  page,
  filtering,
}) => {
  const members = getResponse(page, "/users/query", { status: "active", search: "Filter" });
  await page.goto("/users?q=Filter&status=active&invite_q=filter-pending&keep=filter-test");
  const active = await checked(await members);
  expect(active.items.map((user: { id: string }) => user.id)).toContain(
    filtering.operations.user_ids[0],
  );
  expect(active.items.map((user: { id: string }) => user.id)).not.toContain(
    filtering.operations.user_ids[1],
  );
  await page.getByRole("checkbox", { name: "选择 Filter Active", exact: true }).check();
  const inactive = getResponse(page, "/users/query", { status: "inactive", search: "Filter" });
  await page.getByRole("combobox", { name: "账号状态", exact: true }).selectOption("inactive");
  const result = await checked(await inactive);
  expect(result.items.map((user: { id: string }) => user.id)).toEqual([
    filtering.operations.user_ids[1],
  ]);
  await expect(page.getByRole("button", { name: "清除选择", exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("checkbox", { name: "选择 Filter Inactive", exact: true }),
  ).not.toBeChecked();
  const invitations = getResponse(page, "/invitations/query", { search: "filter-pending" });
  await page.getByRole("button", { name: /邀请记录/ }).click();
  const inviteResult = await checked(await invitations);
  expect(inviteResult.items.map((invite: { id: string }) => invite.id)).toEqual([
    filtering.operations.invitation_ids[0],
  ]);
  await expect(page.getByRole("textbox", { name: "搜索邀请", exact: true })).toHaveValue(
    "filter-pending",
  );
  const exportResponse = getResponse(page, "/invitations/export", { search: "filter-pending" });
  const downloadReady = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出筛选结果", exact: true }).click();
  const exported = await exportResponse;
  expect(exported.ok()).toBe(true);
  const download = await downloadReady;
  const csv = await readFile((await download.path())!, "utf8");
  expect(csv).toContain("filter-pending@example.test");
  expect(csv).not.toContain("filter-accepted@example.test");
  const params = new URL(page.url()).searchParams;
  expect(params.get("q")).toBe("Filter");
  expect(params.get("status")).toBe("inactive");
  expect(params.get("keep")).toBe("filter-test");
});

test("dataset filters preserve deep-link state and browser history", async ({
  page,
  filtering,
}) => {
  const initial = getResponse(page, "/datasets", { search: "Filter Ops", data_type: "image" });
  await page.goto(
    "/datasets?" +
      new URLSearchParams({
        q: "Filter Ops",
        data_type: "image",
        dataset: filtering.operations.dataset_ids[0],
        keep: "filter-test",
      }),
  );
  const images = await checked(await initial);
  expect(images.items.map((item: { id: string }) => item.id)).toEqual([
    filtering.operations.dataset_ids[0],
  ]);
  const imageRow = page.locator("#dataset-row-" + filtering.operations.dataset_ids[0]);
  await expect(imageRow.getByRole("button", { name: "收起" })).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.has("dataset")).toBe(false);
  const next = getResponse(page, "/datasets", { search: "Filter Ops", data_type: "video" });
  await page.getByRole("button", { name: "视频", exact: true }).click();
  const videos = await checked(await next);
  expect(videos.items.map((item: { id: string }) => item.id)).toEqual([
    filtering.operations.dataset_ids[1],
  ]);
  await expect(
    page
      .locator("#dataset-row-" + filtering.operations.dataset_ids[1])
      .getByRole("button", { name: "展开" }),
  ).toBeVisible();
  await page.goBack();
  await expect.poll(() => new URL(page.url()).searchParams.get("data_type")).toBe("image");
  await expect(imageRow).toBeVisible();
  await page.goForward();
  await expect.poll(() => new URL(page.url()).searchParams.get("data_type")).toBe("video");
  await page.reload();
  await expect(page.locator("#dataset-row-" + filtering.operations.dataset_ids[1])).toBeVisible();
  expect(new URL(page.url()).searchParams.get("keep")).toBe("filter-test");
});

test("template default scope stays private and explicit all survives reload", async ({
  page,
  filtering,
}) => {
  const initial = getResponse(page, "/project-templates", { search: "Filter", scope: "private" });
  await page.goto("/project-templates?q=Filter&keep=filter-test");
  const mine = await checked(await initial);
  expect(mine.map((item: { id: string }) => item.id)).toEqual([
    filtering.operations.template_ids[0],
  ]);
  const allResponse = getResponse(page, "/project-templates", { search: "Filter" });
  await page.getByRole("button", { name: "全部", exact: true }).click();
  const all = await checked(await allResponse);
  expect(all.map((item: { id: string }) => item.id).sort()).toEqual(
    [...filtering.operations.template_ids].sort(),
  );
  await expect.poll(() => new URL(page.url()).searchParams.get("scope")).toBe("all");
  await page.reload();
  await expect(page.getByText("Filter Public Template", { exact: true })).toBeVisible();
  await expect(page.getByText("Filter Private Template", { exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("keep")).toBe("filter-test");
});

test("audit detail edits preserve an explicit empty value through reload", async ({
  page,
  filtering,
}) => {
  const rows = getResponse(page, "/audit-logs", { detail_key: "scope", detail_value: "alpha" });
  await page.goto("/audit?detail_key=scope&detail_value=alpha&scope=all&keep=filter-test");
  const initial = await checked(await rows);
  expect(JSON.stringify(initial)).toContain(filtering.operations.project_ids[0]);
  const empty = getResponse(page, "/audit-logs", { detail_key: "scope", detail_value: "" });
  await page.getByPlaceholder("detail 键值（如 super_admin）").fill("");
  await checked(await empty);
  await expect.poll(() => new URL(page.url()).searchParams.get("detail_value")).toBe("");
  await page.reload();
  await expect(page.getByPlaceholder("detail 键名（如 role）")).toHaveValue("scope");
  await expect(page.getByPlaceholder("detail 键值（如 super_admin）")).toHaveValue("");
  expect(new URL(page.url()).searchParams.get("keep")).toBe("filter-test");
});

test("video job filters survive refresh and keep the image status namespace", async ({
  page,
  filtering,
}) => {
  const project = filtering.video.project_id;
  const jobs = getResponse(page, "/video-tracker-jobs", {
    project_id: project,
    status: "pending_review",
  });
  await page.goto(
    "/ai-pre/jobs?" +
      new URLSearchParams({
        tab: "video",
        project_id: project,
        status: "failed",
        video_status: "pending_review",
        keep: "filter-test",
      }),
  );
  const result = await checked(await jobs);
  expect(result.items.length).toBeGreaterThan(0);
  expect(result.items.every((job: { status: string }) => job.status === "pending_review")).toBe(
    true,
  );
  await expect(page.getByRole("combobox", { name: "筛选视频任务状态" })).toHaveValue(
    "pending_review",
  );
  await page.reload();
  await expect(page.getByRole("combobox", { name: "筛选视频任务状态" })).toHaveValue(
    "pending_review",
  );
  expect(new URL(page.url()).searchParams.get("status")).toBe("failed");
  expect(new URL(page.url()).searchParams.get("keep")).toBe("filter-test");
});

test("image job search keeps spaces and applies its page reset with the debounced query", async ({
  page,
  filtering,
}) => {
  const initial = getResponse(page, "/async-jobs", { offset: "20" });
  await page.goto("/ai-pre/jobs?page=2&keep=filter-test");
  await checked(await initial);
  const applied = getResponse(page, "/async-jobs", { search: "alpha complete", offset: "0" });
  const seen: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/v1/async-jobs" && url.searchParams.has("kind"))
      seen.push(url.search);
  });
  const search = page.getByPlaceholder("搜索 prompt...");
  await search.pressSequentially("alpha complete", { delay: 15 });
  const jobs = await checked(await applied);
  expect(jobs.items.map((job: { id: string }) => job.id)).toEqual([
    filtering.operations.job_ids[0],
  ]);
  await expect(search).toHaveValue("alpha complete");
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("alpha complete");
  expect(new URL(page.url()).searchParams.has("page")).toBe(false);
  expect(seen).toHaveLength(1);
  await page.reload();
  await expect(search).toHaveValue("alpha complete");
  expect(new URL(page.url()).searchParams.get("keep")).toBe("filter-test");
});
