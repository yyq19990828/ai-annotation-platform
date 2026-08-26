import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useAbortableImage } from "./useAbortableImage";

class FakeImage extends EventTarget {
  static instances: FakeImage[] = [];
  private value = "";
  decode = vi.fn().mockResolvedValue(undefined);

  constructor() {
    super();
    FakeImage.instances.push(this);
  }

  get src() {
    return this.value;
  }

  set src(value: string) {
    this.value = value;
  }
}

describe("useAbortableImage", () => {
  afterEach(() => {
    FakeImage.instances = [];
    vi.unstubAllGlobals();
  });

  it("源变化和卸载时清空旧 image.src 以终止下载", () => {
    vi.stubGlobal("Image", FakeImage);
    const { rerender, unmount } = renderHook(({ url }) => useAbortableImage(url), {
      initialProps: { url: "/first.png" },
    });
    const first = FakeImage.instances[0];
    expect(first?.src).toBe("/first.png");

    rerender({ url: "/latest.png" });
    expect(first?.src).toBe("");
    const latest = FakeImage.instances[1];
    expect(latest?.src).toBe("/latest.png");

    unmount();
    expect(latest?.src).toBe("");
  });
});
