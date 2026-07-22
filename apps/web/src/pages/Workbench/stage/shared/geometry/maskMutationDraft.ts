import type { AnnotationResponse } from "@/types";
import type { MaskMutationScope } from "@/api/maskMutations";
import { resolveVideoMaskTrackAtFrame } from "../../videoStageGeometry";

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
}

export function maskMutationScopeMembers(
  annotations: readonly AnnotationResponse[],
  scope: MaskMutationScope,
): AnnotationResponse[] {
  return annotations
    .filter((annotation) => annotation.is_active && !annotation.id.startsWith("tmp_"))
    .filter((annotation) => {
      if (scope.media === "image") return annotation.geometry.type === "raster_mask";
      return annotation.geometry.type === "video_track_mask"
        && scope.frame_index !== null
        && resolveVideoMaskTrackAtFrame(annotation.geometry, scope.frame_index) !== null;
    })
    .filter((annotation) => scope.instance_filter === "all" || annotation.class_name === scope.class_name)
    .sort((left, right) => left.id.localeCompare(right.id));
}

export async function maskMutationScopeFingerprint(
  scope: MaskMutationScope,
  members: readonly AnnotationResponse[],
): Promise<string> {
  const payload = canonicalJson({ scope, members: members.map((item) => item.id) });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function maskMutationExpectedVersions(
  members: readonly AnnotationResponse[],
): Array<{ annotation_id: string; version: number }> {
  return members.map((annotation) => {
    if (!Number.isInteger(annotation.version) || Number(annotation.version) < 1) {
      throw new Error(`Mask 对象 ${annotation.id} 缺少有效版本，请刷新后重试`);
    }
    return { annotation_id: annotation.id, version: Number(annotation.version) };
  });
}

export function subtractMaskAlpha(
  source: Uint8Array,
  eraser: Uint8Array,
): { alpha: Uint8Array; changedPixels: number; area: number } {
  if (source.length !== eraser.length) throw new Error("Mask 尺寸不一致");
  const alpha = source.slice();
  let changedPixels = 0;
  let area = 0;
  for (let index = 0; index < alpha.length; index += 1) {
    if (alpha[index] && eraser[index]) {
      alpha[index] = 0;
      changedPixels += 1;
    }
    if (alpha[index]) area += 1;
  }
  return { alpha, changedPixels, area };
}

export function maskAlphasIntersect(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) throw new Error("Mask 尺寸不一致");
  return left.some((value, index) => Boolean(value && right[index]));
}
