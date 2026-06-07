import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  WEBCODECS_FLAG_QUERY_KEY,
  chunkDecoderCacheKey,
  decodeChunkToBitmap,
  detectWebCodecsSupport,
  isWebCodecsExperimentEnabled,
  useVideoChunkDecoder,
} from "./useVideoChunkDecoder";

describe("chunkDecoderCacheKey", () => {
  it("与 useVideoBitmapCache 同构 (`${taskId}:${frameIndex}`)", () => {
    expect(chunkDecoderCacheKey("task-1", 0)).toBe("task-1:0");
    expect(chunkDecoderCacheKey("abc", 42)).toBe("abc:42");
  });
});

describe("isWebCodecsExperimentEnabled · flag 解析", () => {
  const storageWith = (value: string | null) => ({ getItem: () => value });

  it("缺省关闭 (无 query 无 storage)", () => {
    expect(isWebCodecsExperimentEnabled("", storageWith(null))).toBe(false);
    expect(isWebCodecsExperimentEnabled(null, null)).toBe(false);
  });

  it("URL query ?webcodecs=1 / =true 开启", () => {
    expect(isWebCodecsExperimentEnabled(`?${WEBCODECS_FLAG_QUERY_KEY}=1`, null)).toBe(true);
    expect(isWebCodecsExperimentEnabled(`?${WEBCODECS_FLAG_QUERY_KEY}=true`, null)).toBe(true);
  });

  it("URL query ?webcodecs=0 显式关闭 (覆盖 storage)", () => {
    expect(
      isWebCodecsExperimentEnabled(`?${WEBCODECS_FLAG_QUERY_KEY}=0`, storageWith("1")),
    ).toBe(false);
  });

  it("localStorage 真值开启 (query 缺省时)", () => {
    expect(isWebCodecsExperimentEnabled("", storageWith("1"))).toBe(true);
    expect(isWebCodecsExperimentEnabled("", storageWith("true"))).toBe(true);
    expect(isWebCodecsExperimentEnabled("", storageWith("0"))).toBe(false);
  });

  it("storage.getItem 抛错时安全降级为 false", () => {
    const throwing = { getItem: () => { throw new Error("blocked"); } };
    expect(isWebCodecsExperimentEnabled("", throwing)).toBe(false);
  });
});

describe("detectWebCodecsSupport · 能力探测", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("jsdom 无 VideoDecoder → false", () => {
    // jsdom 默认没有 VideoDecoder。
    expect(detectWebCodecsSupport()).toBe(false);
  });

  it("存在 VideoDecoder + createImageBitmap → true", () => {
    vi.stubGlobal("VideoDecoder", class {});
    vi.stubGlobal("createImageBitmap", () => Promise.resolve({} as ImageBitmap));
    expect(detectWebCodecsSupport()).toBe(true);
  });
});

describe("decodeChunkToBitmap · 解码核心 + 资源清理", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("不支持 WebCodecs 时返回 null", async () => {
    expect(await decodeChunkToBitmap({ codec: "vp8" }, [], 0)).toBeNull();
  });

  it("解出帧后 VideoFrame 与 VideoDecoder 都被 close()", async () => {
    const frameClose = vi.fn();
    const decoderClose = vi.fn();
    const fakeFrame = { displayWidth: 320, displayHeight: 240, close: frameClose } as unknown as VideoFrame;

    class FakeDecoder {
      private onOutput: (f: VideoFrame) => void;
      constructor(init: { output: (f: VideoFrame) => void; error: () => void }) {
        this.onOutput = init.output;
      }
      configure() {}
      decode() {}
      async flush() {
        this.onOutput(fakeFrame);
      }
      close = decoderClose;
    }

    vi.stubGlobal("VideoDecoder", FakeDecoder);
    vi.stubGlobal("createImageBitmap", () =>
      Promise.resolve({ width: 320, height: 240, close: vi.fn() } as unknown as ImageBitmap),
    );

    const chunk = {} as EncodedVideoChunk;
    const result = await decodeChunkToBitmap({ codec: "vp8" }, [chunk], 0);
    expect(result).not.toBeNull();
    expect(result?.width).toBe(320);
    expect(frameClose).toHaveBeenCalledTimes(1);
    expect(decoderClose).toHaveBeenCalledTimes(1);
  });
});

describe("useVideoChunkDecoder · flag 关闭 (默认) 行为", () => {
  it("WebCodecs 不可用 / flag 关闭时 active=false，decodeChunks no-op", async () => {
    const { result } = renderHook(() =>
      useVideoChunkDecoder({ taskId: "task-1", enabled: false }),
    );
    expect(result.current.active).toBe(false);
    expect(result.current.enabled).toBe(false);
    let decoded: unknown = "sentinel";
    await act(async () => {
      decoded = await result.current.decodeChunks({ codec: "vp8" }, [], 0);
    });
    expect(decoded).toBeNull();
    expect(result.current.showFrame(0)).toBeNull();
  });
});

describe("useVideoChunkDecoder · 缓存与诊断 (mock WebCodecs)", () => {
  const bitmapClose = vi.fn();

  beforeEach(() => {
    bitmapClose.mockClear();
    const fakeFrame = { displayWidth: 4, displayHeight: 4, close: vi.fn() } as unknown as VideoFrame;
    class FakeDecoder {
      private onOutput: (f: VideoFrame) => void;
      constructor(init: { output: (f: VideoFrame) => void; error: () => void }) {
        this.onOutput = init.output;
      }
      configure() {}
      decode() {}
      async flush() {
        this.onOutput(fakeFrame);
      }
      close() {}
    }
    vi.stubGlobal("VideoDecoder", FakeDecoder);
    vi.stubGlobal("createImageBitmap", () =>
      Promise.resolve({ width: 4, height: 4, close: bitmapClose } as unknown as ImageBitmap),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("decodeChunks 入缓存后 showFrame 命中，记 hit", async () => {
    const { result } = renderHook(() =>
      useVideoChunkDecoder({ taskId: "task-1", enabled: true }),
    );
    expect(result.current.active).toBe(true);

    await act(async () => {
      await result.current.decodeChunks({ codec: "vp8" }, [{} as EncodedVideoChunk], 7);
    });
    expect(result.current.diagnostics.decodes).toBe(1);
    expect(result.current.diagnostics.cacheSize).toBe(1);

    let hit: unknown = null;
    act(() => {
      hit = result.current.showFrame(7);
    });
    expect(hit).not.toBeNull();
    expect(result.current.diagnostics.hits).toBe(1);

    act(() => {
      result.current.showFrame(99);
    });
    expect(result.current.diagnostics.misses).toBe(1);
  });

  it("clear() 释放缓存中全部 ImageBitmap", async () => {
    const { result } = renderHook(() =>
      useVideoChunkDecoder({ taskId: "task-1", enabled: true }),
    );
    await act(async () => {
      await result.current.decodeChunks({ codec: "vp8" }, [{} as EncodedVideoChunk], 1);
    });
    bitmapClose.mockClear();
    act(() => {
      result.current.clear();
    });
    expect(bitmapClose).toHaveBeenCalledTimes(1);
    expect(result.current.diagnostics.cacheSize).toBe(0);
  });

  it("卸载时清理缓存里的 ImageBitmap", async () => {
    const { result, unmount } = renderHook(() =>
      useVideoChunkDecoder({ taskId: "task-1", enabled: true }),
    );
    await act(async () => {
      await result.current.decodeChunks({ codec: "vp8" }, [{} as EncodedVideoChunk], 2);
    });
    bitmapClose.mockClear();
    unmount();
    expect(bitmapClose).toHaveBeenCalledTimes(1);
  });
});
