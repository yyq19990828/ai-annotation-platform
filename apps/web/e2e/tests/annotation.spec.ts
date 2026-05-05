import { test } from "@playwright/test";

test.describe("annotation workbench", () => {
  test.skip("打开任务 → bbox 标注 → 提交", async () => {
    // 占位：待 fixture 准备好种子任务后启用
    //   const taskId = await seedTaskWithImage();
    //   await page.goto(`/workbench/${taskId}`);
    //   ... 模拟拖拽画框 ...
    //   await page.getByRole("button", { name: "提交" }).click();
  });

  test.skip("快捷键标注流：W / E / R 切换工具", async () => {
    // 占位
  });
});
