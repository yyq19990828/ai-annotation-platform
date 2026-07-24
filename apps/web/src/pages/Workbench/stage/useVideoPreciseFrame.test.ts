// useVideoPreciseFrame pipeline 编排:manifest v2 → chunk 轮询 → samples → bytes → decode。
// query 层 mock tasksApi/videoApi/fetch;decode 层用真实 useVideoChunkDecoder + stub WebCodecs。
import { createElement } from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { tasksApi } from "@/api/tasks";
import { videoApi } from "@/api/videos";
import type { VideoChunkOut, VideoChunkSamplesResponse, VideoManifestV2Response } from "@/types";
import { WEBCODECS_FLAG_STORAGE_KEY } from "./useVideoChunkDecoder";
import { retryAfterSecondsToMs, useVideoPreciseFrame } from "./useVideoPreciseFrame";

vi.mock("@/api/tasks", () => ({
  tasksApi: { getVideoManifestV2: vi.fn() },
}));
vi.mock("@/api/videos", () => ({
  videoApi: { getChunk: vi.fn(), getChunkSamples: vi.fn() },
}));

const getManifestV2 = vi.mocked(tasksApi.getVideoManifestV2);
const getChunk = vi.mocked(videoApi.getChunk);
const getSamples = vi.mocked(videoApi.getChunkSamples);

// ── WebCodecs 替身(真实走 useVideoChunkDecoder.decodePlan → decodePlanToBitmap)────

function fakeFrame(timestamp: number) {
  const close = vi.fn();
  return {
    frame: { timestamp, displayWidth: 320, displayHeight: 240, close } as unknown as VideoFrame,
    close,
  };
}
function fakeBitmap() {
  return { width: 320, height: 240, close: vi.fn() } as unknown as ImageBitmap;
}

class FakeDecoder {
  readonly output: (f: VideoFrame) => void;
  configure = vi.fn();
  decode = vi.fn();
  flush = vi.fn().mockResolvedValue(undefined);
  close = vi.fn();
  constructor(init: { output: (f: VideoFrame) => void }) {
    this.output = init.output;
  }
  emit(frame: VideoFrame) {
    this.output(frame);
  }
}

interface DecoderCtrl {
  flushImpl: ((d: FakeDecoder) => void | Promise<void>) | null;
  supported: boolean;
}
let decoderCtrl: DecoderCtrl;
let decoders: FakeDecoder[];

function installWebCodecs() {
  decoderCtrl = { flushImpl: null, supported: true };
  decoders = [];
  vi.stubGlobal("EncodedVideoChunk", class {});
  vi.stubGlobal("createImageBitmap", () => Promise.resolve(fakeBitmap()));
  class FakeVideoDecoder extends FakeDecoder {
    static isConfigSupported = vi.fn(async () => ({
      supported: decoderCtrl.supported,
      config: undefined,
    }));
    constructor(init: { output: (f: VideoFrame) => void }) {
      super(init);
      decoders.push(this);
      this.flush.mockImplementation(async () => {
        if (decoderCtrl.flushImpl) await decoderCtrl.flushImpl(this);
      });
    }
  }
  vi.stubGlobal("VideoDecoder", FakeVideoDecoder);
}

// ── fixtures ──────────────────────────────────────────────────────────────────

function manifest(chunkSize = 10): VideoManifestV2Response {
  return {
    task_id: "t1",
    dataset_item_id: "ds-1",
    video_url: "http://x/v.mp4",
    poster_url: null,
    fps: 30,
    frame_count: 100,
    duration_ms: 3300,
    chunks_manifest_url: "http://x/chunks",
    frame_timetable_url: "http://x/tt",
    frame_service_base: "http://x",
    chunk_size_frames: chunkSize,
    segments: [],
    frame_cache_formats: ["webp", "jpeg"],
    expires_in: 3600,
  };
}
function readyChunk(url = "http://storage/chunk.mp4"): VideoChunkOut {
  return {
    chunk_id: 0,
    start_frame: 0,
    end_frame: 9,
    status: "ready",
    url,
    byte_size: 100,
    generation_mode: null,
    diagnostics: null,
    retry_after: null,
    error: null,
  };
}
function pendingChunk(retryAfter = 1): VideoChunkOut {
  return { ...readyChunk(), status: "pending", url: null, retry_after: retryAfter };
}
function failedChunk(): VideoChunkOut {
  return { ...readyChunk(), status: "failed", url: null, error: "transcode failed" };
}
function samples(frame = 5, ptsMs = 166): VideoChunkSamplesResponse {
  return {
    dataset_item_id: "ds-1",
    chunk_id: 0,
    codec_string: "avc1.4d001e",
    description: btoa("config"),
    width: 320,
    height: 240,
    samples: [
      {
        frame_index: frame,
        pts_ms: ptsMs,
        duration_ms: 33,
        is_keyframe: true,
        size_bytes: 10,
        offset_in_chunk: 0,
      },
    ],
  };
}

function makeBytes(n = 64): ArrayBuffer {
  const buf = new ArrayBuffer(n);
  const v = new Uint8Array(buf);
  for (let i = 0; i < n; i++) v[i] = i & 0xff;
  return buf;
}

function apiError(status: number, detail = "err") {
  const e = new Error(detail);
  (e as { status?: number }).status = status;
  return e;
}

let queryClient: QueryClient;
function Wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

function renderPrecise(initialProps: Parameters<typeof useVideoPreciseFrame>[0]) {
  return renderHook(
    (props: Parameters<typeof useVideoPreciseFrame>[0]) => useVideoPreciseFrame(props),
    { initialProps, wrapper: Wrapper },
  );
}

describe("useVideoPreciseFrame", () => {
  beforeEach(() => {
    vi.useRealTimers();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0, staleTime: 0, refetchOnWindowFocus: false },
      },
    });
    getManifestV2.mockReset();
    getChunk.mockReset();
    getSamples.mockReset();
    vi.spyOn(global, "fetch").mockReset();
    localStorage.setItem(WEBCODECS_FLAG_STORAGE_KEY, "1");
    installWebCodecs();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    localStorage.removeItem(WEBCODECS_FLAG_STORAGE_KEY);
    queryClient.clear();
  });

  it("将后端 retry_after 秒数转换为毫秒并限制轮询区间", () => {
    expect(retryAfterSecondsToMs(3)).toBe(3000);
    expect(retryAfterSecondsToMs(0.25)).toBe(1000);
    expect(retryAfterSecondsToMs(30)).toBe(10_000);
  });

  it("flag 关闭(decoder inactive)→ manifest/chunk/samples/bytes 零请求,sourceState=disabled", async () => {
    vi.unstubAllGlobals(); // jsdom 无 WebCodecs → decoder inactive
    const { result } = renderPrecise({ taskId: "t1", frameIndex: 5, enabled: true, maxItems: 8 });
    expect(result.current.sourceState).toBe("disabled");
    expect(result.current.active).toBe(false);
    // 等 React Query 空转稳定。
    await waitFor(() => expect(getManifestV2).not.toHaveBeenCalled());
    expect(getChunk).not.toHaveBeenCalled();
    expect(getSamples).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("enabled=false(播放 / seeking 中)→ manifest 不请求", async () => {
    const { result } = renderPrecise({ taskId: "t1", frameIndex: 5, enabled: false, maxItems: 8 });
    expect(result.current.sourceState).toBe("disabled");
    await waitFor(() => expect(getManifestV2).not.toHaveBeenCalled());
  });

  it("manifest chunk_size_frames 非法 → fallback api_unavailable", async () => {
    getManifestV2.mockResolvedValue({ ...manifest(0) });
    const { result } = renderPrecise({ taskId: "t1", frameIndex: 5, enabled: true, maxItems: 8 });
    await waitFor(() => expect(result.current.fallbackReason).toBe("api_unavailable"));
    expect(getChunk).not.toHaveBeenCalled();
  });

  it("chunk failed → fallback chunk_failed", async () => {
    getManifestV2.mockResolvedValue(manifest());
    getChunk.mockResolvedValue(failedChunk());
    const { result } = renderPrecise({ taskId: "t1", frameIndex: 5, enabled: true, maxItems: 8 });
    await waitFor(() => expect(result.current.fallbackReason).toBe("chunk_failed"));
  });

  it("chunk query reject → fallback api_unavailable", async () => {
    getManifestV2.mockResolvedValue(manifest());
    getChunk.mockRejectedValue(apiError(500, "chunk unavailable"));
    const { result } = renderPrecise({
      taskId: "t1",
      frameIndex: 5,
      enabled: true,
      maxItems: 8,
    });
    await waitFor(() => expect(result.current.fallbackReason).toBe("api_unavailable"));
    expect(result.current.sourceState).toBe("fallback");
  });

  it("samples 404 → fallback samples_unavailable,不重试", async () => {
    getManifestV2.mockResolvedValue(manifest());
    getChunk.mockResolvedValue(readyChunk());
    getSamples.mockRejectedValue(apiError(404, "samples_not_available"));
    const { result } = renderPrecise({ taskId: "t1", frameIndex: 5, enabled: true, maxItems: 8 });
    await waitFor(() => expect(result.current.fallbackReason).toBe("samples_unavailable"));
    // retry:false → 只请求一次。
    expect(getSamples).toHaveBeenCalledTimes(1);
  });

  it("chunk bytes 500 → fallback chunk_fetch_failed", async () => {
    getManifestV2.mockResolvedValue(manifest());
    getChunk.mockResolvedValue(readyChunk());
    getSamples.mockResolvedValue(samples());
    vi.mocked(global.fetch).mockResolvedValue({ ok: false, status: 500 } as Response);
    const { result } = renderPrecise({ taskId: "t1", frameIndex: 5, enabled: true, maxItems: 8 });
    await waitFor(() => expect(result.current.fallbackReason).toBe("chunk_fetch_failed"));
  });

  it("chunk pending → 按 retry_after 轮询 → ready 后继续 pipeline", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    getManifestV2.mockResolvedValue(manifest());
    getChunk.mockResolvedValueOnce(pendingChunk(3)).mockResolvedValueOnce(readyChunk());
    getSamples.mockResolvedValue(samples());
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(makeBytes()),
    } as Response);
    decoderCtrl.flushImpl = async (d) => {
      d.emit(fakeFrame(166000).frame);
    };
    const { result } = renderPrecise({ taskId: "t1", frameIndex: 5, enabled: true, maxItems: 8 });
    await waitFor(() => expect(result.current.sourceState).toBe("chunk-pending"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    await waitFor(() => expect(result.current.sourceState).toBe("ready"));
    expect(getChunk).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("chunk bytes 403 → 等 metadata 新 URL 后只重取一次并恢复 ready", async () => {
    getManifestV2.mockResolvedValue(manifest());
    getChunk
      .mockResolvedValueOnce(readyChunk("http://storage/expired.mp4"))
      .mockResolvedValueOnce(readyChunk("http://storage/fresh.mp4"));
    getSamples.mockResolvedValue(samples());
    vi.mocked(global.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("expired")) return { ok: false, status: 403 } as Response;
      return {
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(makeBytes()),
      } as Response;
    });
    decoderCtrl.flushImpl = async (d) => {
      d.emit(fakeFrame(166000).frame);
    };

    const { result } = renderPrecise({
      taskId: "t1",
      frameIndex: 5,
      enabled: true,
      maxItems: 8,
    });

    await waitFor(() => expect(result.current.sourceState).toBe("ready"));
    expect(getChunk).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(global.fetch).mock.calls.map(([url]) => String(url))).toEqual([
      "http://storage/expired.mp4",
      "http://storage/fresh.mp4",
    ]);
    expect(result.current.diagnostics.urlRefreshed).toBe(true);
  });

  it("刷新后的 signed URL 再次 403 → 不循环刷新并 fallback", async () => {
    getManifestV2.mockResolvedValue(manifest());
    getChunk
      .mockResolvedValueOnce(readyChunk("http://storage/expired.mp4"))
      .mockResolvedValueOnce(readyChunk("http://storage/still-expired.mp4"));
    getSamples.mockResolvedValue(samples());
    vi.mocked(global.fetch).mockResolvedValue({ ok: false, status: 403 } as Response);

    const { result } = renderPrecise({
      taskId: "t1",
      frameIndex: 5,
      enabled: true,
      maxItems: 8,
    });

    await waitFor(() => expect(result.current.fallbackReason).toBe("chunk_fetch_failed"));
    expect(getChunk).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("decode 成功 → sourceState ready + bitmap frameIndex 匹配", async () => {
    getManifestV2.mockResolvedValue(manifest());
    getChunk.mockResolvedValue(readyChunk());
    getSamples.mockResolvedValue(samples(5, 166));
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(makeBytes()),
    } as Response);
    decoderCtrl.flushImpl = async (d) => {
      d.emit(fakeFrame(166000).frame);
    };
    const { result } = renderPrecise({ taskId: "t1", frameIndex: 5, enabled: true, maxItems: 8 });
    await waitFor(() => expect(result.current.sourceState).toBe("ready"));
    expect(result.current.bitmap).not.toBeNull();
    expect(result.current.bitmap?.frameIndex).toBe(5);
  });

  it("decode 失败(decoder error)→ fallback decode_failed", async () => {
    getManifestV2.mockResolvedValue(manifest());
    getChunk.mockResolvedValue(readyChunk());
    getSamples.mockResolvedValue(samples(5, 166));
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(makeBytes()),
    } as Response);
    // flush 不 emit 任何帧 → wanted null → decode_failed。
    decoderCtrl.flushImpl = async () => {};
    const { result } = renderPrecise({ taskId: "t1", frameIndex: 5, enabled: true, maxItems: 8 });
    await waitFor(() => expect(result.current.fallbackReason).toBe("decode_failed"));
    expect(result.current.bitmap).toBeNull();
  });

  it("codec config unsupported → 保留 codec_unsupported reason", async () => {
    getManifestV2.mockResolvedValue(manifest());
    getChunk.mockResolvedValue(readyChunk());
    getSamples.mockResolvedValue(samples(5, 166));
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(makeBytes()),
    } as Response);
    decoderCtrl.supported = false;

    const { result } = renderPrecise({
      taskId: "t1",
      frameIndex: 5,
      enabled: true,
      maxItems: 8,
    });
    await waitFor(() => expect(result.current.fallbackReason).toBe("codec_unsupported"));
    expect(result.current.sourceState).toBe("fallback");
    expect(decoders).toHaveLength(0);
  });

  it("卸载时中止在途 manifest 请求", async () => {
    const requestSignal: { current: AbortSignal | null } = { current: null };
    getManifestV2.mockImplementation(
      (_taskId, init) =>
        new Promise<VideoManifestV2Response>((_resolve, reject) => {
          requestSignal.current = init?.signal ?? null;
          requestSignal.current?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    const { unmount } = renderPrecise({
      taskId: "t1",
      frameIndex: 5,
      enabled: true,
      maxItems: 8,
    });
    await waitFor(() => expect(getManifestV2).toHaveBeenCalledTimes(1));
    unmount();
    expect(requestSignal.current?.aborted).toBe(true);
  });

  it("frame 切换后旧 precise bitmap 不显示(frameIndex 守卫,防 stale)", async () => {
    getManifestV2.mockResolvedValue(manifest());
    getChunk.mockResolvedValue(readyChunk());
    getSamples.mockResolvedValue(samples(5, 166));
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(makeBytes()),
    } as Response);
    decoderCtrl.flushImpl = async (d) => {
      d.emit(fakeFrame(166000).frame);
    };
    const { result, rerender } = renderPrecise({
      taskId: "t1",
      frameIndex: 5,
      enabled: true,
      maxItems: 8,
    });
    await waitFor(() => expect(result.current.bitmap?.frameIndex).toBe(5));
    // 快速 seek 到 frame 6:即便旧 frame 5 的 bitmap 仍在 decoder 缓存,frameIndex 守卫确保它
    // 不被当作当前帧显示(bitmap.frameIndex 必须严格匹配当前 frameIndex)。
    act(() => {
      rerender({ taskId: "t1", frameIndex: 6, enabled: true, maxItems: 8 });
    });
    expect(result.current.bitmap).toBeNull();
  });

  // latest-request-wins decode 竞态(decode 进行中切帧/task):由 decode effect 的 `cancelled`
  // cleanup + `latestRef.{taskId,frameIndex,enabled}` 检查实现;同类竞态(task 切换丢弃旧
  // bitmap、staleResults 计数)已在 useVideoChunkDecoder.test.ts 覆盖。
});
