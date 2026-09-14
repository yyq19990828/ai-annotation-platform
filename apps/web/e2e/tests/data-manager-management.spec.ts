import { readFile } from "node:fs/promises";
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

test("project members include the owner and zero-activity members, with scoped CSV", async ({
  page,
  filtering,
}) => {
  const projectId = filtering.image.project_id;
  const endpoint = `/api/v1/projects/${projectId}/performance/members`;
  const listResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === endpoint && response.request().method() === "GET",
  );
  await page.goto(`/projects/${projectId}/data-manager?section=members&keep=management-test`);
  const response = await listResponse;
  expect(response.ok(), await response.text()).toBe(true);
  const result = await response.json();
  expect(result.items.map((item: { user_id: string }) => item.user_id)).toEqual(
    expect.arrayContaining([filtering.users.admin, filtering.users.anno, filtering.users.rev]),
  );
  for (const item of result.items) {
    await expect(page.getByText(item.name, { exact: true }).first()).toBeVisible();
  }
  expect(
    result.items.find((item: { user_id: string }) => item.user_id === filtering.users.admin)
      .is_owner,
  ).toBe(true);
  await expect(page.getByRole("table")).toBeVisible();
  expect(new URL(page.url()).searchParams.get("keep")).toBe("management-test");

  const downloaded = page.waitForEvent("download");
  const exportResponse = page.waitForResponse(
    (item) => new URL(item.url()).pathname === `/api/v1/projects/${projectId}/performance/export`,
  );
  await page.getByRole("button", { name: /导出 CSV/ }).click();
  const exported = await exportResponse;
  expect(exported.ok(), await exported.text()).toBe(true);
  const listQuery = new URL(response.url()).searchParams;
  const exportQuery = new URL(exported.url()).searchParams;
  for (const key of [
    "from",
    "to",
    "timezone",
    "work_type",
    "account_status",
    "include_historical",
  ]) {
    expect(exportQuery.get(key)).toBe(listQuery.get(key));
  }
  const download = await downloaded;
  const path = await download.path();
  expect(path).not.toBeNull();
  const csv = await readFile(path!, "utf8");
  expect(csv).toContain(filtering.users.anno);
  expect(csv).toContain(filtering.users.admin);
});

test("Data filters stay separate from member analytics through section navigation", async ({
  page,
  filtering,
}) => {
  const projectId = filtering.image.project_id;
  const expression = { field: "task.status", op: "eq", value: "pending" };
  const params = new URLSearchParams({
    section: "data",
    filter: JSON.stringify({ v: 1, value: expression }),
  });
  await page.goto(`/projects/${projectId}/data-manager?${params}`);
  await expect(page.getByRole("table")).toBeVisible();
  const membersResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/v1/projects/${projectId}/performance/members`,
  );
  await page
    .getByRole("navigation", { name: "Data Manager 项目区域" })
    .getByRole("button", { name: /成员绩效/ })
    .click();
  const response = await membersResponse;
  expect(response.ok(), await response.text()).toBe(true);
  const query = new URL(response.url()).searchParams;
  expect(query.has("filter")).toBe(false);
  expect(query.has("filter_json")).toBe(false);
  expect(query.get("q")).toBeNull();
  await page
    .getByRole("navigation", { name: "Data Manager 项目区域" })
    .getByRole("button", { name: /数据浏览/ })
    .click();
  await expect(page.getByRole("table")).toBeVisible();
  expect(JSON.parse(new URL(page.url()).searchParams.get("filter")!).value).toEqual(expression);
});

test("ordinary members cannot read team analytics or team CSV", async ({
  page,
  request,
  seed,
  filtering,
}) => {
  const projectId = filtering.image.project_id;
  const token = await seed.accessToken(filtering.user_emails.anno);
  for (const path of ["members", "export"]) {
    const response = await request.get(
      `${API_BASE}/api/v1/projects/${projectId}/performance/${path}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    expect([403, 404]).toContain(response.status());
  }
  await seed.injectToken(page, filtering.user_emails.anno);
  await page.goto(`/projects/${projectId}/data-manager`);
  await expect(page.getByRole("table")).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Data Manager 项目区域" })
      .getByRole("button", { name: /成员绩效/ }),
  ).toHaveCount(0);
});
