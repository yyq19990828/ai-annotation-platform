import { expect, test } from "@playwright/test";

test.describe("auth", () => {
  test("健康检查接口可用", async ({ request }) => {
    const res = await request.get("/health");
    expect(res.ok()).toBeTruthy();
  });

  test.skip("登录页可访问 → 输入凭证 → 跳转主面板", async () => {
    // TODO: 待登录页选择器与种子用户固定后启用
    //   await page.goto("/login");
    //   await page.getByLabel("邮箱").fill("admin@example.com");
    //   await page.getByLabel("密码").fill("password");
    //   await page.getByRole("button", { name: "登录" }).click();
    //   await expect(page).toHaveURL(/dashboard/);
  });
});
