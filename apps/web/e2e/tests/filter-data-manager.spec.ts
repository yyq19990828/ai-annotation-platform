import type { Page, Response } from "@playwright/test";
import { expect, test as base, type FilteringSeedManifest } from "../fixtures/seed";
import { resetFiltering } from "../fixtures/filtering";

const API_BASE = process.env.PLAYWRIGHT_API_BASE ?? "http://127.0.0.1:18110";
const test = base.extend<{ filtering: FilteringSeedManifest }>({
  filtering: async ({ seed, page }, provideFixture) => {
    const data = await resetFiltering(seed);
    await seed.injectToken(page, data.user_emails.admin);
    await provideFixture(data);
  },
});

test.setTimeout(120_000);

function queryResponse(page: Page, projectId: string, grain: "tasks" | "objects" | "tracks") {
  const suffix =
    grain === "tasks"
      ? "/projects/" + projectId + "/tasks/query"
      : "/projects/" + projectId + "/data-manager/" + grain + "/query";
  return page.waitForResponse(
    (response) => response.url().endsWith(suffix) && response.request().method() === "POST",
  );
}

async function checked(response: Response) {
  expect(response.ok(), response.status() + " " + (await response.text())).toBe(true);
  return response.json();
}

function url(projectId: string, state: Record<string, string> = {}) {
  return "/projects/" + projectId + "/data-manager?" + new URLSearchParams(state).toString();
}

function envelope(value: unknown) {
  return JSON.stringify({ v: 1, value });
}

test("AI review restores OR and required attributes restore nested groups", async ({
  page,
  request,
  seed,
  filtering,
}) => {
  const videoResponse = queryResponse(page, filtering.video.project_id, "tasks");
  await page.goto(url(filtering.video.project_id, { view: "builtin:ai-review" }));
  const video = await checked(await videoResponse);
  expect(video.items.map((item: { id: string }) => item.id).sort()).toEqual(
    [...filtering.video.expected.ai_review_or_task_ids].sort(),
  );
  expect(video.total).toBe(3);
  await expect(page.getByRole("table")).toBeVisible();

  const token = await seed.accessToken(filtering.user_emails.admin);
  const viewsResponse = await request.get(
    API_BASE + "/api/v1/projects/" + filtering.image.project_id + "/task-views",
    { headers: { Authorization: "Bearer " + token } },
  );
  expect(viewsResponse.ok()).toBe(true);
  const views = await viewsResponse.json();
  const required = views.items.find(
    (view: { key: string }) => view.key === "missing-required-attributes",
  );
  expect(required.filter_json.op).toBe("or");
  expect(required.filter_json.rules.some((rule: { op?: string }) => rule.op === "and")).toBe(true);
  const requiredResponse = queryResponse(page, filtering.image.project_id, "tasks");
  await page.goto(url(filtering.image.project_id, { view: "builtin:missing-required-attributes" }));
  const response = await requiredResponse;
  expect(response.request().postDataJSON().filter_json).toEqual(required.filter_json);
  const missing = await checked(response);
  expect(missing.items.map((item: { id: string }) => item.id).sort()).toEqual(
    [...filtering.image.expected.missing_required_task_ids].sort(),
  );
  await expect(page.getByRole("table")).toBeVisible();
  // A short saved-view URL may stay short until an edit; reload must restore the same tree.
  const reloadResponse = queryResponse(page, filtering.image.project_id, "tasks");
  await page.reload();
  const reloaded = await reloadResponse;
  expect(reloaded.request().postDataJSON().filter_json).toEqual(required.filter_json);
  await checked(reloaded);
});

test("same-object conditions survive reload and separate from browser keyword state", async ({
  page,
  seed,
  filtering,
}) => {
  await seed.injectToken(page, filtering.user_emails.anno);
  const expression = {
    op: "and",
    rules: [
      { field: "annotation.class_name", op: "eq", value: "car" },
      { field: "annotation.attribute.bbox.color", op: "eq", value: "blue" },
    ],
  };
  const state = { lens: "tasks", filter: envelope(expression), keep: "filter-test" };
  for (let pass = 0; pass < 2; pass += 1) {
    const response = queryResponse(page, filtering.image.project_id, "tasks");
    if (pass === 0) await page.goto(url(filtering.image.project_id, state));
    else await page.reload();
    const result = await checked(await response);
    expect(result.items.map((item: { id: string }) => item.id)).toEqual(
      filtering.image.expected.same_object_task_ids,
    );
    await expect(page.getByRole("table")).toBeVisible();
    const search = new URL(page.url()).searchParams;
    expect(search.get("keep")).toBe("filter-test");
    expect(JSON.parse(search.get("filter")!).value).toEqual(expression);
  }

  const input = page.getByRole("textbox", { name: "搜索任务编号或文件名" });
  await expect(input).toHaveValue("");
  const requests: unknown[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/tasks/query") && request.method() === "POST") {
      requests.push(request.postDataJSON());
    }
  });
  const changed = queryResponse(page, filtering.image.project_id, "tasks");
  await input.pressSequentially("same_object", { delay: 20 });
  await checked(await changed);
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("same_object");
  expect(requests).toHaveLength(1);
  expect(JSON.stringify(requests[0])).toContain("same_object");
  expect(new URL(page.url()).searchParams.get("keep")).toBe("filter-test");
});

test("object and logical-track totals retain full scope across cursor pages", async ({
  page,
  seed,
  filtering,
}) => {
  const objectsResponse = queryResponse(page, filtering.paging.project_id, "objects");
  await page.goto(url(filtering.paging.project_id, { lens: "objects" }));
  const objects = await checked(await objectsResponse);
  expect(objects.total).toBe(101);
  expect(objects.items.map((item: { annotation_id: string }) => item.annotation_id)).toEqual(
    filtering.paging.expected_page_one_object_ids,
  );
  await expect(page.getByRole("table")).toHaveAttribute("aria-rowcount", "101");
  const moreObjects = queryResponse(page, filtering.paging.project_id, "objects");
  await page.getByRole("table").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const next = await checked(await moreObjects);
  expect(next.total).toBe(101);
  expect(next.items.map((item: { annotation_id: string }) => item.annotation_id)).toEqual(
    filtering.paging.expected_page_two_object_ids,
  );

  await seed.injectToken(page, filtering.user_emails.anno);
  const tracksResponse = queryResponse(page, filtering.lidar.project_id, "tracks");
  await page.goto(url(filtering.lidar.project_id, { lens: "tracks" }));
  const tracks = await checked(await tracksResponse);
  expect(tracks.total).toBe(filtering.lidar.track_refs.length);
  await expect(page.getByRole("table")).toHaveAttribute(
    "aria-rowcount",
    String(filtering.lidar.track_refs.length),
  );
  const moreTracks = queryResponse(page, filtering.lidar.project_id, "tracks");
  await page.getByRole("table").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const trackNext = await checked(await moreTracks);
  const refs = [...tracks.items, ...trackNext.items].map(
    (item: { track_id: string }) => item.track_id,
  );
  expect(new Set(refs).size).toBe(refs.length);
  expect(refs.sort()).toEqual([...filtering.lidar.track_refs].sort());
});

test("restricted actor cannot discover the hidden batch through rows or totals", async ({
  page,
  seed,
  filtering,
}) => {
  await seed.injectToken(page, filtering.user_emails.anno);
  const response = queryResponse(page, filtering.image.project_id, "tasks");
  await page.goto(url(filtering.image.project_id, { lens: "tasks" }));
  const result = await checked(await response);
  expect(result.items.map((item: { id: string }) => item.id).sort()).toEqual(
    [...filtering.image.expected.visible_task_ids].sort(),
  );
  expect(result.total).toBe(filtering.image.expected.visible_task_ids.length);
  await expect(page.getByRole("table")).toBeVisible();
  for (const hiddenId of filtering.image.expected.hidden_task_ids) {
    expect(JSON.stringify(result)).not.toContain(hiddenId);
  }
});

test("incomplete numeric draft blocks save and retains the last applied query", async ({
  page,
  filtering,
}) => {
  const expression = { field: "annotation.annotation_count", op: "gte", value: 0 };
  const initial = queryResponse(page, filtering.image.project_id, "tasks");
  await page.goto(
    url(filtering.image.project_id, { filter: envelope(expression), keep: "filter-test" }),
  );
  await checked(await initial);
  const requests: unknown[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/tasks/query") && request.method() === "POST")
      requests.push(request.postDataJSON());
  });
  await page.getByRole("button", { name: /标注数.*0/ }).click();
  const value = page.getByRole("textbox", { name: "条件值", exact: true });
  await value.fill("1.");
  await expect(value).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("button", { name: "保存视图", exact: true })).toBeDisabled();
  expect(JSON.parse(new URL(page.url()).searchParams.get("filter")!).value).toEqual(expression);
  expect(requests).toHaveLength(0);
  await value.fill("2");
  const applied = queryResponse(page, filtering.image.project_id, "tasks");
  await value.press("Enter");
  const response = await applied;
  expect(response.request().postDataJSON().filter_json).toEqual({ ...expression, value: 2 });
  await checked(response);
  await expect
    .poll(() => JSON.parse(new URL(page.url()).searchParams.get("filter")!).value.value)
    .toBe(2);
});

test("deep restored expression stays visible as an error and never becomes an unfiltered query", async ({
  page,
  filtering,
}) => {
  let expression: unknown = { field: "task.status", op: "eq", value: "pending" };
  for (let depth = 0; depth < 40; depth += 1) expression = { op: "and", rules: [expression] };
  const raw = envelope(expression);
  const requests: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/tasks/query") && request.method() === "POST")
      requests.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url(filtering.image.project_id, { filter: raw, keep: "filter-test" }));
  await expect(page.getByRole("alert").filter({ hasText: "筛选条件嵌套超过 32 层" })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("filter")).toBe(raw);
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});
