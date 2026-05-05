import { test } from "@playwright/test";

test.describe("batch lifecycle", () => {
  test.skip("创建批次 → 分配人员 → 完成 → 审核 → 导出", async () => {
    // 占位：完整批次流转，覆盖 super_admin / project_admin / annotator / reviewer 四角色
  });
});
