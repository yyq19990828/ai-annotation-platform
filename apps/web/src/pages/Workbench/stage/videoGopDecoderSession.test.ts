// VideoGopDecoderSession 状态机:增量 decode、reset、timestamp waiter、generation、
// 串行命令队列、idle/hidden 计时。用可控 fake VideoDecoder 覆盖正确性与资源释放。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildGopPlan, type VideoGopPlan } from "./videoChunkDemux";
import type { VideoChunkSampleEntry, VideoChunkSamplesResponse } from "@/types";
import {
  VideoGopDecoderSession,
  type SessionDecodeRequest,
  type VideoGopSessionIdentity,
} from "./videoGopDecoderSession";

// ── fake 基础设施 ──────────────────────────────────────────────────────────────

interface RecordedChunkInit {
  type: "key" | "delta";
  timestamp: number;
  duration?: number;
  data: Uint8Array;
}

class FakeEncodedVideoChunk {
  readonly type: RecordedChunkInit["type"];
  readonly timestamp: number;
  readonly duration: number | undefined;
  readonly byteLength: number;
  constructor(init: RecordedChunkInit) {
    this.type = init.type;
    this.timestamp = init.timestamp;
    this.duration = init.duration;
    this.byteLength = init.data.byteLength;
  }
  copyTo(): void {}
  clone(): FakeEncodedVideoChunk {
    return new FakeEncodedVideoChunk({
      type: this.type,
      timestamp: this.timestamp,
      duration: this.duration,
      data: new Uint8Array(this.byteLength),
    });
  }
}

class FakeSessionDecoder {
  readonly output: (f: VideoFrame) => void;
  private readonly errorCb: (e: DOMException) => void;
  configure = vi.fn();
  decode = vi.fn();
  flush = vi.fn();
  reset = vi.fn();
  close = vi.fn();
  constructor(init: { output: (f: VideoFrame) => void; error: (e: DOMException) => void }) {
    this.output = init.output;
    this.errorCb = init.error;
  }
  emit(frame: VideoFrame) {
    this.output(frame);
  }
  emitError(err: DOMException) {
    this.errorCb(err);
  }
}

interface SessionDecoderCtrl {
  supported: boolean;
  supportConfig: VideoDecoderConfig | undefined;
  supportThrow: boolean;
  configureThrow: boolean;
  flushImpl: ((d: FakeSessionDecoder) => void | Promise<void>) | null;
  flushThrow: boolean;
  flushError: DOMException | null;
}

let ctrl: SessionDecoderCtrl;
let decoders: FakeSessionDecoder[];

function installSessionDecoder(): void {
  ctrl = {
    supported: true,
    supportConfig: undefined,
    supportThrow: false,
    configureThrow: false,
    flushImpl: null,
    flushThrow: false,
    flushError: null,
  };
  decoders = [];
  vi.stubGlobal("EncodedVideoChunk", FakeEncodedVideoChunk);
  class FakeVideoDecoder extends FakeSessionDecoder {
    static isConfigSupported = vi.fn(async () => {
      if (ctrl.supportThrow) throw new Error("support failed");
      return { supported: ctrl.supported, config: ctrl.supportConfig };
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
}

function fakeFrame(timestamp: number) {
  return {
    timestamp,
    displayWidth: 320,
    displayHeight: 240,
    close: vi.fn(),
  } as unknown as VideoFrame;
}

const lastDecoder = () => decoders[decoders.length - 1];

/** 默认 flush:emit 最后一次 decode 的 chunk 对应 timestamp 的目标 frame。 */
function defaultFlushEmitTarget(): void {
  ctrl.flushImpl = async (d) => {
    const calls = vi.mocked(d.decode).mock.calls;
    if (calls.length === 0) return;
    const lastChunk = calls[calls.length - 1][0] as { timestamp: number };
    d.emit(fakeFrame(lastChunk.timestamp));
  };
}

// ── fixtures ──────────────────────────────────────────────────────────────────

function makeBytes(n: number): ArrayBuffer {
  const buf = new ArrayBuffer(n);
  const view = new Uint8Array(buf);
  for (let i = 0; i < n; i++) view[i] = (i * 7) & 0xff;
  return buf;
}

function makeSamples(
  entries: Array<{ frame: number; pts: number; dur?: number; key?: boolean }>,
  opts: { width?: number; height?: number } = {},
): VideoChunkSamplesResponse {
  const samples: VideoChunkSampleEntry[] = [];
  let cursor = 0;
  for (const e of entries) {
    const size = 10;
    const offset = cursor;
    cursor = offset + size;
    samples.push({
      frame_index: e.frame,
      pts_ms: e.pts,
      duration_ms: e.dur ?? 33,
      is_keyframe: e.key ?? false,
      size_bytes: size,
      offset_in_chunk: offset,
    });
  }
  return {
    dataset_item_id: "ds-1",
    chunk_id: 0,
    codec_string: "avc1.4d001e",
    description: btoa("config-bytes"),
    width: opts.width ?? 320,
    height: opts.height ?? 240,
    samples,
  };
}

/** 单 GOP(I/P,decode order == presentation order):frame 0 为 key,其余 delta。 */
function gopPlan(frameCount: number): VideoGopPlan {
  const entries = Array.from({ length: frameCount }, (_, f) => ({
    frame: f,
    pts: f * 33,
    key: f === 0,
  }));
  const samples = makeSamples(entries);
  const bytes = makeBytes(frameCount * 10 + 16);
  const result = buildGopPlan(bytes, samples, 0);
  if (!result.ok) throw new Error("gopPlan build failed");
  return result.plan;
}

function identity(plan: VideoGopPlan, taskId = "t1"): VideoGopSessionIdentity {
  return {
    taskId,
    datasetItemId: "ds-1",
    chunkId: plan.chunkId,
    gopStartDecodeIndex: plan.gopStartDecodeIndex,
    configFingerprint: plan.configFingerprint,
  };
}

function req(plan: VideoGopPlan, decodeIndex: number, generation = 0): SessionDecodeRequest {
  const sample = plan.samples[decodeIndex - plan.gopStartDecodeIndex];
  return {
    frameIndex: sample.frameIndex,
    targetDecodeIndex: decodeIndex,
    targetTimestampUs: sample.timestampUs,
    generation,
  };
}

function newSession(
  plan: VideoGopPlan,
  opts: Partial<ConstructorParameters<typeof VideoGopDecoderSession>[0]> = {},
) {
  return new VideoGopDecoderSession({ plan, identity: identity(plan), ...opts });
}

// ── 测试 ──────────────────────────────────────────────────────────────────────

describe("VideoGopDecoderSession", () => {
  beforeEach(() => {
    installSessionDecoder();
    defaultFlushEmitTarget();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("configure 使用 isConfigSupported 返回的规范化 config", async () => {
    const plan = gopPlan(10);
    const normalized: VideoDecoderConfig = { ...plan.config, codedWidth: 1280 };
    ctrl.supportConfig = normalized;
    const session = newSession(plan);
    await session.decode(req(plan, 0));
    expect(lastDecoder().configure).toHaveBeenCalledWith(normalized);
    expect(session.getStats().sessionCreates).toBe(1);
  });

  it("首目标从 GOP key sample 提交到目标(提交 0..target 共 target+1 个 chunk)", async () => {
    const plan = gopPlan(30);
    const session = newSession(plan);
    await session.decode(req(plan, 5));
    expect(lastDecoder().decode).toHaveBeenCalledTimes(6);
    expect(session.getStats().submits).toBe(6);
    expect(session.getStats().cursor).toBe(5);
  });

  it("同 GOP 向前逐帧只提交增量 chunks(不退回平方级重解)", async () => {
    const plan = gopPlan(30);
    const session = newSession(plan);
    await session.decode(req(plan, 5));
    await session.decode(req(plan, 10));
    // 第二次只提交 samples[6..10] = 5 个,而非重新提交 0..10。
    expect(lastDecoder().decode).toHaveBeenCalledTimes(6 + 5);
    expect(session.getStats().submits).toBe(11);
    expect(session.getStats().resets).toBe(0);
  });

  it("同一目标 cache miss(原地)触发 reset 重解", async () => {
    const plan = gopPlan(30);
    const session = newSession(plan);
    await session.decode(req(plan, 5));
    vi.mocked(lastDecoder().decode).mockClear();
    await session.decode(req(plan, 5)); // target === cursor → hardReset + 重解 0..5
    expect(lastDecoder().reset).toHaveBeenCalledTimes(1);
    expect(lastDecoder().decode).toHaveBeenCalledTimes(6);
    expect(session.getStats().resets).toBe(1);
  });

  it("后退(target < cursor)触发 reset + reconfigure,从 key 重解", async () => {
    const plan = gopPlan(30);
    const session = newSession(plan);
    await session.decode(req(plan, 10));
    vi.mocked(lastDecoder().decode).mockClear();
    await session.decode(req(plan, 5)); // 后退
    expect(lastDecoder().reset).toHaveBeenCalledTimes(1);
    expect(lastDecoder().configure).toHaveBeenCalledTimes(2); // 初始 + reconfigure
    expect(lastDecoder().decode).toHaveBeenCalledTimes(6); // 0..5
    expect(session.getStats().resets).toBe(1);
  });

  it("dispose 关闭 decoder;新建 session 与旧 session 互不干扰(identity 隔离)", async () => {
    const plan = gopPlan(10);
    const session = newSession(plan);
    await session.decode(req(plan, 3));
    const firstDecoder = lastDecoder();
    session.dispose();
    expect(firstDecoder.close).toHaveBeenCalledTimes(1);
    expect(session.getStats().state).toBe("closed");
    // closed 后新请求返回 disposed。
    const outcome = await session.decode(req(plan, 4));
    expect(outcome).toEqual({ ok: false, reason: "disposed" });
  });

  it("output 乱序仍按 timestamp 命中目标(B 帧 decode order ≠ pts order)", async () => {
    // decode order: frame0(key,pts0) → frame2(pts66) → frame1(pts33)。
    const samples = makeSamples([
      { frame: 0, pts: 0, key: true },
      { frame: 2, pts: 66, key: false },
      { frame: 1, pts: 33, key: false },
    ]);
    const bytes = makeBytes(64);
    const built = buildGopPlan(bytes, samples, 1);
    if (!built.ok) throw new Error("build failed");
    const plan = built.plan;
    ctrl.flushImpl = async (d) => {
      // 按 decode order 全量 emit(frame0 → frame2 → frame1)。
      d.emit(fakeFrame(0));
      d.emit(fakeFrame(66000));
      d.emit(fakeFrame(33000)); // target(pts 33 → 33000us)最后到
    };
    const session = newSession(plan);
    const outcome = await session.decode(req(plan, 2)); // decodeIndex 2 = frame1(pts33)
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.frame.timestamp).toBe(33000);
  });

  it("非目标 output 立即 close", async () => {
    const plan = gopPlan(10);
    const nonTarget = fakeFrame(0); // decodeIndex 0 的 pts=0,目标是 decodeIndex 3(pts 99→99000)
    ctrl.flushImpl = async (d) => {
      d.emit(nonTarget); // 非 target
      const calls = vi.mocked(d.decode).mock.calls;
      const lastChunk = calls[calls.length - 1][0] as { timestamp: number };
      d.emit(fakeFrame(lastChunk.timestamp)); // target
    };
    const session = newSession(plan);
    await session.decode(req(plan, 3));
    expect(vi.mocked(nonTarget.close)).toHaveBeenCalledTimes(1);
  });

  it("重复 timestamp 只保留第一份,其余 close 并计诊断", async () => {
    const plan = gopPlan(10);
    const first = fakeFrame(99000);
    const dup = fakeFrame(99000);
    ctrl.flushImpl = async (d) => {
      d.emit(first);
      d.emit(dup);
    };
    const session = newSession(plan);
    await session.decode(req(plan, 3));
    expect(vi.mocked(first.close)).not.toHaveBeenCalled();
    expect(vi.mocked(dup.close)).toHaveBeenCalledTimes(1);
    expect(session.getStats().duplicateOutputs).toBe(1);
  });

  it("decoder error 拒绝当前 waiter 并进入 failed;后续请求也失败", async () => {
    const plan = gopPlan(10);
    ctrl.flushError = new DOMException("decode error");
    const session = newSession(plan);
    const outcome = await session.decode(req(plan, 3));
    expect(outcome).toEqual({ ok: false, reason: "decoder_error" });
    expect(session.getStats().state).toBe("failed");
    const again = await session.decode(req(plan, 4));
    expect(again).toEqual({ ok: false, reason: "decoder_error" });
  });

  it("flush 后无目标 output → target_timestamp_missing", async () => {
    const plan = gopPlan(10);
    ctrl.flushImpl = async () => {
      // 不 emit 任何 frame。
    };
    const session = newSession(plan);
    const outcome = await session.decode(req(plan, 3));
    expect(outcome).toEqual({ ok: false, reason: "target_timestamp_missing" });
  });

  it("dispose 幂等;残留 pending frame 与 decoder 均被释放", async () => {
    const plan = gopPlan(10);
    const session = newSession(plan);
    await session.decode(req(plan, 3));
    session.dispose();
    session.dispose(); // 幂等
    expect(lastDecoder().close).toHaveBeenCalledTimes(1);
    expect(session.getStats().disposals).toBe(1);
    expect(session.getStats().state).toBe("closed");
  });

  it("并发命令严格串行(第二个 decode 在第一个完成后才提交)", async () => {
    const plan = gopPlan(30);
    const session = newSession(plan);
    let firstFlushed = false;
    const firstFlush = new Promise<void>((resolve) => {
      ctrl.flushImpl = async (d) => {
        firstFlushed = true;
        const calls = vi.mocked(d.decode).mock.calls;
        const lastChunk = calls[calls.length - 1][0] as { timestamp: number };
        d.emit(fakeFrame(lastChunk.timestamp));
        resolve();
      };
    });
    const p1 = session.decode(req(plan, 5));
    await firstFlush; // 第一个 decode 已 flush,队列仍被占用直到 p1 resolve
    expect(firstFlushed).toBe(true);
    // 第二个 decode 必须排队;在第一个完成前不应提交任何 chunk。
    const before = vi.mocked(lastDecoder().decode).mock.calls.length;
    const p2 = session.decode(req(plan, 8));
    await Promise.all([p1, p2]);
    // 第二个 decode 在第一个之后提交了增量 samples[6..8] = 3 个。
    const afterSecond = vi.mocked(lastDecoder().decode).mock.calls.length;
    expect(afterSecond - before).toBe(3);
    expect(session.getStats().submits).toBe(6 + 3);
  });

  it("hard reset 递增 generation,旧 waiter 失效后重新 decode 得到新 frame", async () => {
    const plan = gopPlan(30);
    const session = newSession(plan);
    const first = await session.decode(req(plan, 5));
    expect(first.ok).toBe(true);
    // 原地再解(reset)→ 新的 output frame,不是残留。
    const second = await session.decode(req(plan, 5));
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.frame).not.toBe(first.frame); // 不同 VideoFrame 实例
      expect(vi.mocked(first.frame.close)).not.toHaveBeenCalled(); // 旧 frame 归调用方
    }
    expect(session.getStats().resets).toBe(1);
  });

  it("idle 超时关闭 session(fake timers)", async () => {
    vi.useFakeTimers();
    const plan = gopPlan(10);
    const session = newSession(plan, { idleTimeoutMs: 1000 });
    await session.decode(req(plan, 3));
    expect(session.getStats().state).toBe("ready");
    await vi.advanceTimersByTimeAsync(1001);
    expect(session.getStats().state).toBe("closed");
    expect(session.getStats().disposals).toBe(1);
  });

  it("document 持续 hidden 超时关闭 session;恢复可见则不触发", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    const plan = gopPlan(10);
    const session = newSession(plan, { hiddenTimeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(999);
    expect(session.getStats().state).not.toBe("closed");
    // 恢复可见 → 清除 hidden 计时。
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(session.getStats().state).not.toBe("closed");
    session.dispose();
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
  });
});

// ── benchmark:30-frame GOP 的提交计数(§12)──────────────────────────────────

describe("VideoGopDecoderSession · 30-frame GOP benchmark", () => {
  beforeEach(() => {
    installSessionDecoder();
    defaultFlushEmitTarget();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("场景 A:0→29 顺序逐帧,encoded chunk submit 总数 ≤ 30(不退回 465)", async () => {
    const plan = gopPlan(30);
    const session = newSession(plan);
    for (let i = 0; i < 30; i++) {
      const outcome = await session.decode(req(plan, i));
      expect(outcome.ok).toBe(true);
    }
    expect(session.getStats().submits).toBeLessThanOrEqual(30);
    expect(session.getStats().resets).toBe(0);
    session.dispose();
    expect(decoders.filter((d) => vi.mocked(d.close).mock.calls.length > 0)).toHaveLength(1);
  });

  it("场景 B:0→10→20→5→6,只在后退(5)时 reset 一次", async () => {
    const plan = gopPlan(30);
    const session = newSession(plan);
    for (const idx of [0, 10, 20, 5, 6]) {
      const outcome = await session.decode(req(plan, idx));
      expect(outcome.ok).toBe(true);
    }
    expect(session.getStats().resets).toBe(1);
    expect(session.getStats().submits).toBeLessThanOrEqual(30);
    session.dispose();
  });

  it("场景 C:快速 3→12→7→29,每次 decode 都成功返回目标 frame", async () => {
    const plan = gopPlan(30);
    const session = newSession(plan);
    for (const idx of [3, 12, 7, 29]) {
      const outcome = await session.decode(req(plan, idx));
      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        const sample = plan.samples[idx - plan.gopStartDecodeIndex];
        expect(outcome.frame.timestamp).toBe(sample.timestampUs);
      }
    }
    session.dispose();
  });
});
