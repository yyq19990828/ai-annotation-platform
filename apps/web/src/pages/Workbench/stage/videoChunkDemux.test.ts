import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildEncodedVideoChunks } from "./videoChunkDemux";
import type { VideoChunkSamplesResponse } from "@/types";

// jsdom 没有 EncodedVideoChunk; 用一个透传 init 的轻量替身, 便于断言入参。
class FakeEncodedVideoChunk {
  type: "key" | "delta";
  timestamp: number;
  byteLength: number;
  constructor(init: { type: "key" | "delta"; timestamp: number; data: ArrayBuffer }) {
    this.type = init.type;
    this.timestamp = init.timestamp;
    this.byteLength = init.data.byteLength;
  }
}

beforeEach(() => {
  vi.stubGlobal("EncodedVideoChunk", FakeEncodedVideoChunk);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function makeResp(): VideoChunkSamplesResponse {
  return {
    dataset_item_id: "item-1",
    chunk_id: 0,
    codec_string: "avc1.4d001e",
    width: 1920,
    height: 1080,
    // 解码顺序: 帧 0(key) 在 [0,10), 帧 1 在 [10,15), 帧 2 在 [15,18)。
    samples: [
      { frame_index: 0, pts_ms: 0, duration_ms: 33, is_keyframe: true, size_bytes: 10, offset_in_chunk: 0 },
      { frame_index: 1, pts_ms: 33, duration_ms: 33, is_keyframe: false, size_bytes: 5, offset_in_chunk: 10 },
      { frame_index: 2, pts_ms: 66, duration_ms: 33, is_keyframe: false, size_bytes: 3, offset_in_chunk: 15 },
    ],
  };
}

describe("buildEncodedVideoChunks", () => {
  it("从最近关键帧到目标帧切出 GOP, 第一块为 key, timestamp 单位为微秒", () => {
    const bytes = new ArrayBuffer(18);
    const built = buildEncodedVideoChunks(bytes, makeResp(), 2);
    expect(built).not.toBeNull();
    const { config, chunks } = built!;
    expect(config.codec).toBe("avc1.4d001e");
    expect(config.codedWidth).toBe(1920);
    expect(config.codedHeight).toBe(1080);
    // 帧 2 之前最近的关键帧是帧 0 → 3 块。
    expect(chunks).toHaveLength(3);
    expect(chunks[0].type).toBe("key");
    expect(chunks[1].type).toBe("delta");
    // pts_ms 66 → 66000 μs。
    expect(chunks[2].timestamp).toBe(66000);
    // 字节切片大小与 size_bytes 一致。
    expect((chunks[0] as unknown as FakeEncodedVideoChunk).byteLength).toBe(10);
    expect((chunks[2] as unknown as FakeEncodedVideoChunk).byteLength).toBe(3);
  });

  it("目标即关键帧时只产出 1 块", () => {
    const built = buildEncodedVideoChunks(new ArrayBuffer(18), makeResp(), 0);
    expect(built!.chunks).toHaveLength(1);
    expect(built!.chunks[0].type).toBe("key");
  });

  it("目标帧不在 samples 中 → 返回 null (降级 <video>)", () => {
    expect(buildEncodedVideoChunks(new ArrayBuffer(18), makeResp(), 99)).toBeNull();
  });
});
