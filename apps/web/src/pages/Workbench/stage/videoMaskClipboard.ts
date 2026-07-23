import type { AnnotationResponse, CocoRleMaskRef, VideoTrackMaskGeometry } from "@/types";
import type { MaskMutationCommitRequest, MaskMutationScope } from "@/api/maskMutations";
import type { CocoRle } from "./shared/geometry/maskRle";
import {
  maskMutationExpectedVersions,
  maskMutationScopeFingerprint,
  maskMutationScopeMembers,
} from "./shared/geometry/maskMutationDraft";

export interface VideoMaskClipboardEntry {
  taskId: string;
  sourceAnnotationId: string;
  sourceVersion: number;
  sourceFrameIndex: number;
  resolvedKeyframeFrame: number;
  className: string;
  mask: CocoRleMaskRef;
  rle: CocoRle;
}

export function validateVideoMaskClipboard(
  clipboard: VideoMaskClipboardEntry | null,
  context: {
    taskId: string | undefined;
    source: AnnotationResponse | undefined;
    width: number;
    height: number;
  },
): string | null {
  if (!clipboard) return "请先复制一个 Mask";
  if (!context.taskId || clipboard.taskId !== context.taskId) return "剪贴板属于其他任务";
  if (!context.source || context.source.geometry.type !== "video_track_mask")
    return "复制来源已不存在";
  if (Number(context.source.version) !== clipboard.sourceVersion)
    return "复制来源已更新，请重新复制";
  if (context.source.class_name !== clipboard.className) return "复制来源类别已变化，请重新复制";
  if (
    clipboard.rle.size[0] !== context.height ||
    clipboard.rle.size[1] !== context.width ||
    clipboard.mask.size[0] !== context.height ||
    clipboard.mask.size[1] !== context.width
  )
    return "Mask 尺寸与当前视频不一致";
  return null;
}

function copyScopeMembers(
  annotations: readonly AnnotationResponse[],
  scope: MaskMutationScope,
  source: AnnotationResponse,
): AnnotationResponse[] {
  const members = maskMutationScopeMembers(annotations, scope);
  if (!members.some((item) => item.id === source.id)) members.push(source);
  return members.sort((left, right) => left.id.localeCompare(right.id));
}

export async function buildVideoMaskCopyKeyframeRequest(input: {
  clipboard: VideoMaskClipboardEntry;
  annotations: readonly AnnotationResponse[];
  source: AnnotationResponse;
  frameIndex: number;
  segmentId: string;
  idempotencyKey: string;
}): Promise<MaskMutationCommitRequest> {
  const scope: MaskMutationScope = {
    media: "video",
    frame_index: input.frameIndex,
    segment_id: input.segmentId,
    instance_filter: "same_class",
    class_name: input.clipboard.className,
    overlap_policy: "allow",
    strict_non_overlap: false,
  };
  const members = copyScopeMembers(input.annotations, scope, input.source);
  const geometry: VideoTrackMaskGeometry = {
    type: "video_track_mask",
    track_id: `trk_${crypto.randomUUID().replace(/-/g, "")}`,
    semantic_label:
      input.source.geometry.type === "video_track_mask"
        ? input.source.geometry.semantic_label
        : undefined,
    keyframes: [
      {
        frame_index: input.frameIndex,
        mask: input.clipboard.mask,
        source: "manual",
        occluded: false,
      },
    ],
    outside: [],
  };
  return {
    idempotency_key: input.idempotencyKey,
    operation: "copy_keyframe",
    scope,
    source_frame_index: input.clipboard.sourceFrameIndex,
    scope_fingerprint: await maskMutationScopeFingerprint(scope, members),
    expected_versions: maskMutationExpectedVersions(members),
    mutations: [
      {
        kind: "create",
        source_annotation_ids: [input.source.id],
        geometry,
      },
    ],
  };
}
