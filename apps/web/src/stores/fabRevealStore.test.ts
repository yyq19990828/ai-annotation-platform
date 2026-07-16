import { describe, expect, it } from "vitest";
import { isPointerInFabRevealZone, isPointerOverFabTarget } from "./fabRevealStore";

describe("fabRevealStore", () => {
  it("只在右下角窄触发带唤出按钮，不覆盖画布最右侧的缩放浮条", () => {
    const viewport = { width: 1440, height: 1000 };

    expect(isPointerInFabRevealZone(1408, 960, viewport.width, viewport.height)).toBe(true);
    expect(isPointerInFabRevealZone(1408, 940, viewport.width, viewport.height)).toBe(false);
    expect(isPointerInFabRevealZone(1360, 980, viewport.width, viewport.height)).toBe(false);
  });

  it("按钮出现后，指针停在 BUG / Issue 按钮自身时保持展开", () => {
    document.body.innerHTML = `
      <button data-bug-fab><span id="bug-icon" /></button>
      <button data-workbench-fab><span id="issue-icon" /></button>
    `;

    expect(isPointerOverFabTarget(document.querySelector("#bug-icon"))).toBe(true);
    expect(isPointerOverFabTarget(document.querySelector("#issue-icon"))).toBe(true);
    expect(isPointerOverFabTarget(document.body)).toBe(false);
  });
});
