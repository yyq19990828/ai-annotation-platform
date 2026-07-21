import { describe, expect, it } from "vitest";
import type { MatrixAxis, ScreenshotScene } from "../../e2e/screenshots/scenes";
import { resolveOutputPath, shouldRunInProject } from "../../e2e/screenshots/matrix";

const darkAxis: MatrixAxis = {
  viewport: "desktop",
  theme: "dark",
  locale: "zh-CN",
};

const lightAxis: MatrixAxis = {
  viewport: "desktop",
  theme: "light",
  locale: "zh-CN",
};

function scene(matrix?: ScreenshotScene["matrix"]): ScreenshotScene {
  return {
    name: "workbench/example",
    role: "annotator",
    route: () => "/workbench",
    matrix,
    target: "docs-site/user-guide/images/workbench/example.png",
  };
}

describe("screenshot matrix", () => {
  it("keeps undeclared scenes on desktop light", () => {
    expect(shouldRunInProject(scene(), lightAxis)).toBe(true);
    expect(shouldRunInProject(scene(), darkAxis)).toBe(false);
  });

  it("writes a dark-primary scene to the canonical target", () => {
    const darkScene = scene({ primaryTheme: "dark" });

    expect(shouldRunInProject(darkScene, darkAxis)).toBe(true);
    expect(shouldRunInProject(darkScene, lightAxis)).toBe(false);
    expect(resolveOutputPath(darkScene, darkAxis)).toBe(
      "docs-site/user-guide/images/workbench/example.png",
    );
  });

  it("suffixes a non-primary light variant", () => {
    const dualThemeScene = scene({
      themes: ["light", "dark"],
      primaryTheme: "dark",
    });

    expect(resolveOutputPath(dualThemeScene, lightAxis)).toBe(
      "docs-site/user-guide/images/workbench/example.light.png",
    );
  });
});
