// 纯函数 demux:把后端预解析的 chunk 字节 + packet sample manifest 切成 WebCodecs
// EncodedVideoChunk[] + VideoDecoderConfig。不解析容器(moov/stbl/stco/...),容器真值
// 由后端 ffprobe -show_packets 提供;sample 数组保持 packet decode order,frame_index
// 按 PTS presentation rank 赋值(B 帧时两者不同)。解码目标帧用输入 chunk 的 pts timestamp
// 匹配 output VideoFrame.timestamp,绝不把全局 frameIndex 当 output 数组下标。

import type { VideoChunkSamplesResponse } from "@/types";

/**
 * 精确帧 pipeline 的稳定 fallback 枚举(E2E / 诊断 / bug report 附件共用)。
 * chunk_pending 是过渡态,不计错误;其余 reason 只进本地诊断,不向普通用户弹错误。
 */
export type PreciseFrameFallbackReason =
  | "flag_disabled"
  | "api_unavailable"
  | "dataset_item_missing"
  | "chunk_pending"
  | "chunk_failed"
  | "samples_unavailable"
  | "description_unavailable"
  | "codec_unsupported"
  | "invalid_sample_range"
  | "chunk_fetch_failed"
  | "decode_failed"
  | "stale_request"
  | "memory_budget_exceeded";

export interface EncodedVideoDecodePlan {
  config: VideoDecoderConfig;
  /** decode order: 从 GOP 起点关键帧到目标帧的全部 access unit。 */
  chunks: EncodedVideoChunk[];
  /** 目标帧的全局平台帧号(缓存键 + 用户语义,非 decoder output 下标)。 */
  targetFrameIndex: number;
  /** 目标 sample 的 pts(微秒),用作 decoder output 选择键。 */
  targetTimestampUs: number;
  chunkId: number;
  gopStartDecodeIndex: number;
  targetDecodeIndex: number;
}

export type BuildEncodedVideoDecodePlanResult =
  | { ok: true; plan: EncodedVideoDecodePlan }
  | { ok: false; reason: PreciseFrameFallbackReason };

/** base64 → Uint8Bytes;非法 base64 返回 null(不抛)。 */
function decodeBase64ToBytes(b64: string): Uint8Array | null {
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/**
 * 从 chunk 字节 + sample manifest 构造目标帧的解码计划。
 *
 * 返回 discriminated result:`ok:true` 带 plan,`ok:false` 带稳定 fallback reason。
 * 调用方(precise hook)据此决定继续 decode 还是安全回退。
 */
export function buildEncodedVideoDecodePlan(
  chunkBytes: ArrayBuffer,
  samples: VideoChunkSamplesResponse,
  targetFrameIndex: number,
): BuildEncodedVideoDecodePlanResult {
  // 1. 契约基础:codec string / coded 尺寸 / samples 非空。
  if (
    !samples.codec_string ||
    !Number.isFinite(samples.width) ||
    samples.width <= 0 ||
    !Number.isFinite(samples.height) ||
    samples.height <= 0 ||
    !Array.isArray(samples.samples) ||
    samples.samples.length === 0
  ) {
    return { ok: false, reason: "invalid_sample_range" };
  }

  // 2. 在保持 packet decode order 的 samples 中定位目标帧(presentation rank)。
  const targetDecodeIndex = samples.samples.findIndex((s) => s.frame_index === targetFrameIndex);
  if (targetDecodeIndex < 0) {
    return { ok: false, reason: "invalid_sample_range" };
  }

  // 3. 从目标向前找最近关键帧(GOP 起点);4. 未找到则回退,不把首个 delta 伪造成 key。
  let gopStartDecodeIndex = -1;
  for (let i = targetDecodeIndex; i >= 0; i--) {
    if (samples.samples[i].is_keyframe) {
      gopStartDecodeIndex = i;
      break;
    }
  }
  if (gopStartDecodeIndex < 0) {
    return { ok: false, reason: "invalid_sample_range" };
  }

  // 5. 验证 [gopStart, target] 每个 sample 的字节边界 + 时间戳有限性。
  const byteLen = chunkBytes.byteLength;
  for (let i = gopStartDecodeIndex; i <= targetDecodeIndex; i++) {
    const s = samples.samples[i];
    if (
      !Number.isSafeInteger(s.offset_in_chunk) ||
      !Number.isSafeInteger(s.size_bytes) ||
      s.offset_in_chunk < 0 ||
      s.size_bytes <= 0 ||
      s.offset_in_chunk + s.size_bytes > byteLen ||
      !Number.isFinite(s.pts_ms) ||
      !Number.isFinite(s.duration_ms)
    ) {
      return { ok: false, reason: "invalid_sample_range" };
    }
  }

  // 10. base64 description(avcC/hvcC extradata)解成字节。当前 chunk 是 MP4 AVCC/HVCC
  //     sample,缺 description 不尝试 Annex-B 猜测,也不在前端转 NALU 格式。
  const descRaw = samples.description;
  if (!descRaw) {
    return { ok: false, reason: "description_unavailable" };
  }
  const description = decodeBase64ToBytes(descRaw);
  if (!description || description.length === 0) {
    return { ok: false, reason: "description_unavailable" };
  }

  // 6-9. 按 decode order 构造 EncodedVideoChunk[]。用 Uint8Array view 直接引用 chunkBytes
  //      (offset, size),避免先 slice() 产生一次不必要副本;原生 constructor 自行决定是否复制。
  const chunks: EncodedVideoChunk[] = [];
  for (let i = gopStartDecodeIndex; i <= targetDecodeIndex; i++) {
    const s = samples.samples[i];
    const view = new Uint8Array(chunkBytes, s.offset_in_chunk, s.size_bytes);
    const init: EncodedVideoChunkInit = {
      type: s.is_keyframe ? "key" : "delta",
      timestamp: Math.round(s.pts_ms * 1000),
      data: view,
    };
    if (s.duration_ms > 0) init.duration = Math.round(s.duration_ms * 1000);
    chunks.push(new EncodedVideoChunk(init));
  }

  const targetSample = samples.samples[targetDecodeIndex];
  const targetTimestampUs = Math.round(targetSample.pts_ms * 1000);

  // 11-12. config 用 codec + codedWidth/codedHeight + description;目标用 timestamp,不传 frameIndex 作下标。
  const config: VideoDecoderConfig = {
    codec: samples.codec_string,
    codedWidth: samples.width,
    codedHeight: samples.height,
    description,
  };

  return {
    ok: true,
    plan: {
      config,
      chunks,
      targetFrameIndex,
      targetTimestampUs,
      chunkId: samples.chunk_id,
      gopStartDecodeIndex,
      targetDecodeIndex,
    },
  };
}
