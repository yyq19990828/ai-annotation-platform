import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { EncodedVideoDecodePlan } from "./videoChunkDemux";
import {
  WEBCODECS_FLAG_QUERY_KEY,
  chunkDecoderCacheKey,
  decodePlanToBitmap,
  detectWebCodecsSupport,
  isWebCodecsExperimentEnabled,
  useVideoChunkDecoder,
  type VideoChunkDecodeResult,
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
    expect(isWebCodecsExperimentEnabled(`?${WEBCODECS_FLAG_QUERY_KEY}=0`, storageWith("1"))).toBe(
      false,
    );
  });

  it("localStorage 真值开启 (query 缺省时)", () => {
    expect(isWebCodecsExperimentEnabled("", storageWith("1"))).toBe(true);
    expect(isWebCodecsExperimentEnabled("", storageWith("true"))).toBe(true);
    expect(isWebCodecsExperimentEnabled("", storageWith("0"))).toBe(false);
  });

  it("storage.getItem 抛错时安全降级为 false", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
    };
    expect(isWebCodecsExperimentEnabled("", throwing)).toBe(false);
  });
});

describe("detectWebCodecsSupport · 能力探测", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("jsdom 无 VideoDecoder → false", () => {
    expect(detectWebCodecsSupport()).toBe(false);
  });

  it("存在 VideoDecoder + EncodedVideoChunk + createImageBitmap → true", () => {
    vi.stubGlobal("VideoDecoder", class {});
    vi.stubGlobal("EncodedVideoChunk", class {});
    vi.stubGlobal("createImageBitmap", () => Promise.resolve({} as ImageBitmap));
    expect(detectWebCodecsSupport()).toBe(true);
  });
});

// ── mock 基础设施 ──────────────────────────────────────────────────────────────

function fakeFrame(timestamp: number) {
  const close = vi.fn();
  const frame = {
    timestamp,
    displayWidth: 320,
    displayHeight: 240,
    close,
  } as unknown as VideoFrame;
  return { frame, close };
}

function fakeBitmap() {
  return { width: 320, height: 240, close: vi.fn() } as unknown as ImageBitmap;
}

function makePlan(targetTimestampUs = 33000, frameIndex = 1): EncodedVideoDecodePlan {
  return {
    config: { codec: "avc1.4d001e", codedWidth: 320, codedHeight: 240 },
    chunks: [{} as EncodedVideoChunk],
    targetFrameIndex: frameIndex,
    targetTimestampUs,
    chunkId: 0,
    gopStartDecodeIndex: 0,
    targetDecodeIndex: 0,
  };
}

/** 可控 VideoDecoder 替身:flush 默认 resolve,行为经 controller 配置。 */
class FakeDecoder {
  readonly output: (f: VideoFrame) => void;
  private readonly errorCb: (e: DOMException) => void;
  configure = vi.fn();
  decode = vi.fn();
  flush = vi.fn();
  close = vi.fn();
  constructor(init: { output: (f: VideoFrame) => void; error: (e: DOMException) => void }) {
    this.output = init.output;
    this.errorCb = init.error;
  }
  emit(frame: VideoFrame) {
    this.output(frame);
  }
}

interface DecoderCtrl {
  supported: boolean | null;
  supportThrow: boolean;
  configureThrow: boolean;
  flushImpl: ((d: FakeDecoder) => void | Promise<void>) | null;
  flushThrow: boolean;
  flushError: DOMException | null;
}

/** 安装 VideoDecoder/EncodedVideoChunk 全局替身,返回行为控制器与已建 decoder 列表。 */
function installDecoderMock(): { ctrl: DecoderCtrl; decoders: FakeDecoder[] } {
  const ctrl: DecoderCtrl = {
    supported: null,
    supportThrow: false,
    configureThrow: false,
    flushImpl: null,
    flushThrow: false,
    flushError: null,
  };
  const decoders: FakeDecoder[] = [];
  class FakeVideoDecoder extends FakeDecoder {
    static isConfigSupported = vi.fn(async () => {
      if (ctrl.supportThrow) throw new Error("support failed");
      return { supported: ctrl.supported ?? true, config: undefined };
    });
    constructor(init: { output: (f: VideoFrame) => void; error: (e: DOMException) => void }) {
      super(init);
      decoders.push(this);
      this.configure.mockImplementation(() => {
        if (ctrl.configureThrow) throw new Error("configure failed");
      });
      this.flush.mockImplementation(async () => {
        if (ctrl.flushThrow) throw new Error("flush failed");
        if (ctrl.flushError) init.error(ctrl.flushError);
        if (ctrl.flushImpl) await ctrl.flushImpl(this);
      });
    }
  }
  vi.stubGlobal("VideoDecoder", FakeVideoDecoder);
  vi.stubGlobal("EncodedVideoChunk", class {});
  return { ctrl, decoders };
}

// ── decodePlanToBitmap:按 timestamp 命中 + 资源清理 ───────────────────────────

describe("decodePlanToBitmap · 按 timestamp 选目标 + 资源清理", () => {
  let ctrl: DecoderCtrl;
  let decoders: FakeDecoder[];
  const last = () => decoders[decoders.length - 1];
  beforeEach(() => {
    vi.stubGlobal("createImageBitmap", () => Promise.resolve(fakeBitmap()));
    ({ ctrl, decoders } = installDecoderMock());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("output 乱序仍按 timestamp 命中目标;非目标 frame 立即 close", async () => {
    const a = fakeFrame(66000); // 非 target
    const b = fakeFrame(33000); // target
    ctrl.flushImpl = async (d) => {
      d.emit(a.frame); // 先到的非目标
      d.emit(b.frame); // 后到的目标
    };
    const result = await decodePlanToBitmap(makePlan(33000));
    expect(result).not.toBeNull();
    expect(result?.frameIndex).toBe(1);
    expect(a.close).toHaveBeenCalledTimes(1); // 非目标 emit 时立即 close
    expect(b.close).toHaveBeenCalledTimes(1); // 目标在 finally close
    expect(last().close).toHaveBeenCalledTimes(1);
  });

  it("没有命中 target timestamp → null", async () => {
    const a = fakeFrame(0);
    ctrl.flushImpl = async (d) => {
      d.emit(a.frame);
    };
    expect(await decodePlanToBitmap(makePlan(33000))).toBeNull();
    expect(a.close).toHaveBeenCalledTimes(1);
  });

  it("isConfigSupported=false 不 configure/decode,记 codec_unsupported", async () => {
    ctrl.supported = false;
    const reason = vi.fn();
    expect(await decodePlanToBitmap(makePlan(), reason)).toBeNull();
    expect(decoders).toHaveLength(0);
    expect(reason).toHaveBeenCalledWith("codec_unsupported");
  });

  it("isConfigSupported 抛错 → null + codec_unsupported", async () => {
    ctrl.supportThrow = true;
    const reason = vi.fn();
    expect(await decodePlanToBitmap(makePlan(), reason)).toBeNull();
    expect(decoders).toHaveLength(0);
    expect(reason).toHaveBeenCalledWith("codec_unsupported");
  });

  it("configure 抛错 → null + codec_unsupported", async () => {
    ctrl.configureThrow = true;
    const reason = vi.fn();
    expect(await decodePlanToBitmap(makePlan(), reason)).toBeNull();
    expect(reason).toHaveBeenCalledWith("codec_unsupported");
  });

  it("flush reject → null + decode_failed", async () => {
    ctrl.flushThrow = true;
    const reason = vi.fn();
    expect(await decodePlanToBitmap(makePlan(), reason)).toBeNull();
    expect(reason).toHaveBeenCalledWith("decode_failed");
  });

  it("error callback 触发 → null + decode_failed", async () => {
    ctrl.flushError = new DOMException("decode error");
    const reason = vi.fn();
    expect(await decodePlanToBitmap(makePlan(), reason)).toBeNull();
    expect(reason).toHaveBeenCalledWith("decode_failed");
  });

  it("createImageBitmap 抛错 → null;wanted frame 仍被 close", async () => {
    vi.stubGlobal("createImageBitmap", () => Promise.reject(new Error("oom")));
    const b = fakeFrame(33000);
    ctrl.flushImpl = async (d) => {
      d.emit(b.frame);
    };
    expect(await decodePlanToBitmap(makePlan())).toBeNull();
    expect(b.close).toHaveBeenCalledTimes(1); // finally 仍 close wanted
  });

  it("成功交付的 bitmap 不被 decoder finally close(由缓存接管)", async () => {
    const bmp = fakeBitmap();
    const bmpClose = vi.mocked(bmp.close);
    vi.stubGlobal("createImageBitmap", () => Promise.resolve(bmp));
    ctrl.flushImpl = async (d) => {
      d.emit(fakeFrame(33000).frame);
    };
    const result = await decodePlanToBitmap(makePlan());
    expect(result).not.toBeNull();
    expect(bmpClose).not.toHaveBeenCalled();
  });

  it("不支持 WebCodecs 时返回 null", async () => {
    vi.unstubAllGlobals();
    expect(await decodePlanToBitmap(makePlan())).toBeNull();
  });
});

// ── useVideoChunkDecoder hook ─────────────────────────────────────────────────

describe("useVideoChunkDecoder · flag 关闭 (默认) 行为", () => {
  it("WebCodecs 不可用 / flag 关闭时 active=false,decodePlan no-op", async () => {
    const { result } = renderHook(() => useVideoChunkDecoder({ taskId: "task-1", enabled: false }));
    expect(result.current.active).toBe(false);
    expect(result.current.enabled).toBe(false);
    const decoded: { current: VideoChunkDecodeResult | null } = { current: null };
    await act(async () => {
      decoded.current = await result.current.decodePlan(makePlan());
    });
    expect(decoded.current?.bitmap).toBeNull();
    expect(decoded.current?.fallbackReason).toBe("flag_disabled");
    expect(result.current.showFrame(0)).toBeNull();
  });
});

describe("useVideoChunkDecoder · 缓存、single-flight 与诊断 (mock WebCodecs)", () => {
  let ctrl: DecoderCtrl;
  let decoders: FakeDecoder[];
  const bitmapClose = vi.fn();

  beforeEach(() => {
    bitmapClose.mockClear();
    vi.stubGlobal("createImageBitmap", () =>
      Promise.resolve({ width: 4, height: 4, close: bitmapClose } as unknown as ImageBitmap),
    );
    ({ ctrl, decoders } = installDecoderMock());
    // 默认 flush emit target(匹配 makePlan 默认 33000us)。
    ctrl.flushImpl = async (d) => {
      d.emit(fakeFrame(33000).frame);
    };
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("decodePlan 入缓存(不自动激活);showFrame 命中记 hit 并激活", async () => {
    const { result } = renderHook(() => useVideoChunkDecoder({ taskId: "task-1", enabled: true }));
    expect(result.current.active).toBe(true);

    await act(async () => {
      await result.current.decodePlan(makePlan(33000, 7));
    });
    expect(result.current.diagnostics.decodes).toBe(1);
    expect(result.current.diagnostics.cacheSize).toBe(1);
    // decode 成功只入缓存,不自动激活 active 指针。
    expect(result.current.activeFrameIndex).toBeNull();

    let hit: unknown = null;
    act(() => {
      hit = result.current.showFrame(7);
    });
    expect(hit).not.toBeNull();
    expect(result.current.diagnostics.hits).toBe(1);
    expect(result.current.activeFrameIndex).toBe(7);

    act(() => {
      result.current.showFrame(99);
    });
    expect(result.current.diagnostics.misses).toBe(1);
  });

  it("相同 frame 并发只调用一次底层 decode(single-flight)", async () => {
    const { result } = renderHook(() => useVideoChunkDecoder({ taskId: "t1", enabled: true }));
    let pair: [VideoChunkDecodeResult, VideoChunkDecodeResult] = [
      { bitmap: null, fallbackReason: "decode_failed" },
      { bitmap: null, fallbackReason: "decode_failed" },
    ];
    await act(async () => {
      pair = await Promise.all([
        result.current.decodePlan(makePlan(33000, 5)),
        result.current.decodePlan(makePlan(33000, 5)),
      ]);
    });
    expect(decoders).toHaveLength(1); // 并发共享同一 in-flight promise
    expect(pair[0].bitmap).not.toBeNull();
    expect(pair[1].bitmap).not.toBeNull();
  });

  it("clear() 释放缓存中全部 ImageBitmap", async () => {
    const { result } = renderHook(() => useVideoChunkDecoder({ taskId: "task-1", enabled: true }));
    await act(async () => {
      await result.current.decodePlan(makePlan(33000, 1));
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
      await result.current.decodePlan(makePlan(33000, 2));
    });
    bitmapClose.mockClear();
    unmount();
    expect(bitmapClose).toHaveBeenCalledTimes(1);
  });

  it("task 切换后旧解码结果关闭 bitmap 且不入新缓存(staleResults)", async () => {
    // 在 wanted 帧确定之后、createImageBitmap resolve 之前阻塞,以便切换 task。
    let resolveBitmap: ((b: ImageBitmap) => void) | null = null;
    vi.stubGlobal(
      "createImageBitmap",
      () =>
        new Promise<ImageBitmap>((resolve) => {
          resolveBitmap = resolve;
        }),
    );
    const { result, rerender } = renderHook(
      ({ tid }: { tid: string }) => useVideoChunkDecoder({ taskId: tid, enabled: true }),
      { initialProps: { tid: "t1" } },
    );
    let decodePromise = Promise.resolve({
      bitmap: null,
      fallbackReason: "decode_failed",
    } as VideoChunkDecodeResult);
    await act(async () => {
      decodePromise = result.current.decodePlan(makePlan(33000, 3));
      // 推进 microtask 到 createImageBitmap 阻塞点。
      await new Promise((r) => setTimeout(r, 0));
    });
    // decode 进行中(wanted 已命中,等待 createImageBitmap),task 切到 t2
    // → 旧 taskId(t1) 闭包不再匹配 taskIdRef.current(t2)。
    act(() => {
      rerender({ tid: "t2" });
    });
    let resolved: unknown = "sentinel";
    await act(async () => {
      resolveBitmap?.({
        width: 4,
        height: 4,
        close: bitmapClose,
      } as unknown as ImageBitmap);
      resolved = await decodePromise;
    });
    expect((resolved as VideoChunkDecodeResult).bitmap).toBeNull();
    expect((resolved as VideoChunkDecodeResult).fallbackReason).toBe("stale_request");
    expect(bitmapClose).toHaveBeenCalledTimes(1); // 旧 bitmap 被关闭,不入新缓存
    expect(result.current.diagnostics.staleResults).toBe(1);
  });

  it("在途 decode 完成前卸载 → 新 bitmap 立即 close,不写回已卸载缓存", async () => {
    let resolveBitmap: ((b: ImageBitmap) => void) | null = null;
    vi.stubGlobal(
      "createImageBitmap",
      () =>
        new Promise<ImageBitmap>((resolve) => {
          resolveBitmap = resolve;
        }),
    );
    const { result, unmount } = renderHook(() =>
      useVideoChunkDecoder({ taskId: "t1", enabled: true }),
    );
    let decodePromise = Promise.resolve({
      bitmap: null,
      fallbackReason: "decode_failed",
    } as VideoChunkDecodeResult);
    await act(async () => {
      decodePromise = result.current.decodePlan(makePlan(33000, 9));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    unmount();

    const lateBitmap = {
      width: 4,
      height: 4,
      close: bitmapClose,
    } as unknown as ImageBitmap;
    const decoded: { current: VideoChunkDecodeResult | null } = { current: null };
    await act(async () => {
      resolveBitmap?.(lateBitmap);
      decoded.current = await decodePromise;
    });

    expect(decoded.current?.bitmap).toBeNull();
    expect(decoded.current?.fallbackReason).toBe("stale_request");
    expect(bitmapClose).toHaveBeenCalledTimes(1);
  });
});
