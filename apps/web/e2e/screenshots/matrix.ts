import path from "node:path";
import type { MatrixAxis, ScreenshotScene } from "./scenes";

export const SCREENSHOT_MATRIX_PROJECTS = ["desktop-light", "desktop-dark", "mobile"] as const;

export const PROJECT_AXES: Record<(typeof SCREENSHOT_MATRIX_PROJECTS)[number], MatrixAxis> = {
  "desktop-light": { viewport: "desktop", theme: "light", locale: "zh-CN" },
  "desktop-dark": { viewport: "desktop", theme: "dark", locale: "zh-CN" },
  mobile: { viewport: "mobile", theme: "light", locale: "zh-CN" },
};

export function shouldRunInProject(scene: ScreenshotScene, axis: MatrixAxis): boolean {
  if (!scene.matrix) {
    return axis.viewport === "desktop" && axis.theme === "light";
  }
  const viewports = scene.matrix.viewports ?? ["desktop"];
  const themes = scene.matrix.themes ?? [scene.matrix.primaryTheme ?? "light"];
  const locales = scene.matrix.locales ?? ["zh-CN"];
  return (
    viewports.includes(axis.viewport) &&
    themes.includes(axis.theme) &&
    locales.includes(axis.locale)
  );
}

export function resolveOutputPath(scene: ScreenshotScene, axis: MatrixAxis): string {
  const base = typeof scene.target === "function" ? scene.target(axis) : scene.target;
  const primaryTheme = scene.matrix?.primaryTheme ?? "light";
  const isPrimary =
    axis.viewport === "desktop" && axis.theme === primaryTheme && axis.locale === "zh-CN";
  if (isPrimary) return base;

  const extension = path.extname(base);
  const stem = base.slice(0, -extension.length);
  const parts = [
    axis.theme !== primaryTheme ? axis.theme : null,
    axis.viewport !== "desktop" ? axis.viewport : null,
    axis.locale !== "zh-CN" ? axis.locale : null,
  ].filter(Boolean);
  return `${stem}.${parts.join(".")}${extension}`;
}

export function expectedMatrixTargets(scenes: ScreenshotScene[]): Set<string> {
  const targets = new Set<string>();
  for (const project of SCREENSHOT_MATRIX_PROJECTS) {
    const axis = PROJECT_AXES[project];
    for (const scene of scenes) {
      if (shouldRunInProject(scene, axis)) targets.add(resolveOutputPath(scene, axis));
    }
  }
  return targets;
}
