import type { ScreenshotScene } from "./_types";

export const SAM_SCENES: ScreenshotScene[] = [
  {
    name: "sam/subtoolbar",
    role: "annotator",
    route: (d) => `/projects/${d.project_id}/annotate`,
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      await page.keyboard.press("s");
      await page.waitForTimeout(150);
      await page.waitForSelector('[data-testid="sam-subtoolbar"]', { timeout: 2000 });
    },
    capture: { kind: "locator", selector: '[data-testid="sam-subtoolbar"]', padding: 8 },
    // 三个子工具按钮编号
    annotate: [
      { selector: '[data-testid="sam-tool-point"]', style: "numbered" },
      { selector: '[data-testid="sam-tool-bbox"]',  style: "numbered" },
      { selector: '[data-testid="sam-tool-text"]',  style: "numbered" },
    ],
    target: "docs-site/user-guide/images/sam/subtoolbar.png",
  },
  {
    name: "sam/text-three-modes",
    role: "annotator",
    route: (d) => `/projects/${d.project_id}/annotate`,
    prepare: async (page) => {
      await page.waitForLoadState("networkidle");
      await page.keyboard.press("s"); await page.waitForTimeout(80);
      await page.keyboard.press("s"); await page.waitForTimeout(80);
      await page.keyboard.press("s"); await page.waitForTimeout(80);
      await page.waitForSelector('[data-testid="sam-text-output-mode"]', { timeout: 2000 });
    },
    capture: { kind: "locator", selector: '[data-testid="sam-text-output-mode"]', padding: 12 },
    // 红框高亮三个输出模式选项
    annotate: [
      { selector: '[data-testid="sam-mode-box"]',  style: "rect-red", label: "box"  },
      { selector: '[data-testid="sam-mode-mask"]', style: "rect-red", label: "mask" },
      { selector: '[data-testid="sam-mode-both"]', style: "rect-red", label: "both" },
    ],
    target: "docs-site/user-guide/images/sam/text-three-modes.png",
  },
];
