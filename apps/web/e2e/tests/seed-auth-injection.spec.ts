import { expect, test, type APIRequestContext } from "@playwright/test";
import { SeedAPI } from "../fixtures/seed";

test("token injection preserves origin storage without booting the previous actor's app", async ({
  page,
}) => {
  const origin = "https://seed-auth.test";
  const requests: string[] = [];
  await page.route(`${origin}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith("/api/")) requests.push(path);
    await route.fulfill({
      contentType: "text/html",
      body:
        path === "/"
          ? '<script>fetch("/api/v1/dashboard/admin")</script>'
          : "<!doctype html><title>Fixture page</title>",
    });
  });
  const seed = new SeedAPI({
    post: async (_url: string, options: { data: { email: string } }) => ({
      ok: () => true,
      json: async () => ({ access_token: options.data.email, user: { email: options.data.email } }),
    }),
    patch: async () => ({ ok: () => true }),
  } as unknown as APIRequestContext);

  await page.goto(`${origin}/previous`);
  await page.evaluate(() => {
    localStorage.setItem("token", "old-admin");
    localStorage.setItem("video.experimental.webcodecs", "1");
  });
  for (const email of ["annotator@e2e.test", "reviewer@e2e.test"]) {
    await seed.injectToken(page, email, origin);
    await page.goto(`${origin}/workbench`);
    expect(await page.evaluate(() => localStorage.getItem("token"))).toBe(email);
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem("auth-storage")!).state.user.email),
    ).toBe(email);
    expect(await page.evaluate(() => localStorage.getItem("video.experimental.webcodecs"))).toBe(
      "1",
    );
  }
  expect(requests).toEqual([]);
  // The temporary document interception must not mask later application requests.
  await page.goto(origin);
  await expect.poll(() => requests).toEqual(["/api/v1/dashboard/admin"]);
});
