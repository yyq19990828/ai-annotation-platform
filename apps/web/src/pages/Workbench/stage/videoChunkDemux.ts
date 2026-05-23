import type { VideoChunkSamplesResponse } from "@/types";

/**
 * v0.10.46 · 从 chunk mp4 字节 + sample manifest 构造一段 GOP 的 EncodedVideoChunk[]。
 *
 * 后端 ffprobe 已把 chunk 内每个 packet 的 (offset_in_chunk, size_bytes, pts_ms,
 * is_keyframe) 写进 samples。这里按 frame_index 定位目标帧, 向前回溯到最近的关键帧,
 * 把 [keyframe .. target] 这段 packet 字节切出来, 构造 WebCodecs 原生 EncodedVideoChunk,
 * 直接喂给 useVideoChunkDecoder 的 decodeChunks()。
 *
 * samples 数组是解码顺序 (ffprobe packet 顺序), 满足 VideoDecoder 的喂入顺序要求;
 * frame_index 是展示序号 (presentation rank + start_frame), 仅用于定位目标与关键帧。
 *
 * 找不到 targetFrameIndex 时返回 null, 调用方降级回 <video> 路径。
 */
export function buildEncodedVideoChunks(
  chunkBytes: ArrayBuffer,
  samplesResp: VideoChunkSamplesResponse,
  targetFrameIndex: number,
): { config: VideoDecoderConfig; chunks: EncodedVideoChunk[] } | null {
  const { samples, codec_string, width, height } = samplesResp;

  const targetIdx = samples.findIndex((s) => s.frame_index === targetFrameIndex);
  if (targetIdx === -1) return null;

  // 向前回溯到最近的关键帧 (含 targetIdx 本身)。
  let gopStart = targetIdx;
  while (gopStart > 0 && !samples[gopStart].is_keyframe) gopStart--;

  const chunks: EncodedVideoChunk[] = [];
  for (let i = gopStart; i <= targetIdx; i++) {
    const s = samples[i];
    const data = chunkBytes.slice(s.offset_in_chunk, s.offset_in_chunk + s.size_bytes);
    chunks.push(
      new EncodedVideoChunk({
        type: s.is_keyframe ? "key" : "delta",
        timestamp: s.pts_ms * 1000, // μs
        data,
      }),
    );
  }

  const config: VideoDecoderConfig = {
    codec: codec_string,
    codedWidth: width,
    codedHeight: height,
  };

  return { config, chunks };
}
