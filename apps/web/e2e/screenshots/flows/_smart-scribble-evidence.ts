import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { InteractiveAnnotateResponse, InteractiveRequest } from "../../../src/api/ml-backends";
import type { CocoRle } from "../../../src/pages/Workbench/stage/shared/geometry/maskRle";
import type { AiMaskAcceptResponse } from "../../../src/api/aiMasks";
import type { CandidateReviewCleanupRecord } from "./candidate-review-lifecycle";

export const SMART_SCRIBBLE_MODEL = "sam3-interactive-seg";

/** Warmup shares the transport endpoint but is not a recorded scribble round. */
export function isSmartScribbleRequest(request: InteractiveRequest) {
  return request.context?.type === "scribble" && request.context.model_id === SMART_SCRIBBLE_MODEL;
}

export interface ScribbleSourceIdentity {
  task_id: string;
  annotation_id: string;
  source_version: number;
  source_digest: string;
}

export function scribbleMaskEvidence(rle: CocoRle) {
  assert.equal(rle.encoding, "coco_rle");
  const [height, width] = rle.size;
  assert.ok(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0);
  assert.ok(rle.counts.every((count) => Number.isInteger(count) && count >= 0));
  assert.equal(
    rle.counts.reduce((sum, count) => sum + count, 0),
    width * height,
  );
  const area = rle.counts.reduce((sum, count, index) => sum + (index % 2 ? count : 0), 0);
  assert.ok(area > 0, "SAM3 must return a nonempty mask");
  const content_digest = createHash("sha256")
    .update(JSON.stringify({ encoding: "coco_rle", size: [height, width], counts: rle.counts }))
    .digest("hex");
  const samples: [number, number][] = [];
  let offset = 0;
  let foreground = 0;
  let nextSample = Math.floor(area / 32);
  const step = Math.max(1, Math.floor(area / 16));
  for (const [index, count] of rle.counts.entries()) {
    if (index % 2) {
      while (nextSample < foreground + count && samples.length < 16) {
        const pixel = offset + nextSample - foreground;
        samples.push([
          (Math.floor(pixel / height) + 0.5) / width,
          ((pixel % height) + 0.5) / height,
        ]);
        nextSample += step;
      }
      foreground += count;
    }
    offset += count;
  }
  return { content_digest, area, size: rle.size, samples };
}

/** Sample both directions of the pixel change, excluding shared foreground. */
export function scribbleMaskDifference(previous: CocoRle, current: CocoRle) {
  scribbleMaskEvidence(previous);
  scribbleMaskEvidence(current);
  assert.deepEqual(current.size, previous.size, "Scribble rounds must use the same image size");
  const [height, width] = current.size;
  const added: Array<[number, number]> = [];
  const removed: Array<[number, number]> = [];
  let previousIndex = 0;
  let currentIndex = 0;
  let previousEnd = previous.counts[0];
  let currentEnd = current.counts[0];
  let offset = 0;
  while (offset < width * height) {
    while (previousEnd <= offset) previousEnd += previous.counts[++previousIndex];
    while (currentEnd <= offset) currentEnd += current.counts[++currentIndex];
    const end = Math.min(previousEnd, currentEnd);
    if (previousIndex % 2 !== currentIndex % 2) {
      (currentIndex % 2 ? added : removed).push([offset, end]);
    }
    offset = end;
  }
  assert.ok(added.length + removed.length > 0, "Scribble rounds must differ in actual pixels");
  const sample = (runs: Array<[number, number]>): [number, number][] => {
    const area = runs.reduce((sum, [start, end]) => sum + end - start, 0);
    const count = Math.min(16, area);
    const points: [number, number][] = [];
    let runIndex = 0;
    let preceding = 0;
    for (let index = 0; index < count; index += 1) {
      const rank = Math.floor(((index + 0.5) * area) / count);
      while (rank >= preceding + runs[runIndex][1] - runs[runIndex][0]) {
        preceding += runs[runIndex][1] - runs[runIndex][0];
        runIndex += 1;
      }
      const pixel = runs[runIndex][0] + rank - preceding;
      points.push([(Math.floor(pixel / height) + 0.5) / width, ((pixel % height) + 0.5) / height]);
    }
    return points;
  };
  return { added: sample(added), removed: sample(removed) };
}

export function inspectScribbleRound(
  request: InteractiveRequest,
  response: InteractiveAnnotateResponse,
  source: ScribbleSourceIdentity,
  backendId: string,
  polarities: number[],
) {
  const context = request.context;
  assert.equal(request.task_id, source.task_id);
  assert.equal(context.type, "scribble");
  assert.equal(context.model_id, SMART_SCRIBBLE_MODEL);
  assert.equal(context.output_geometry, "mask");
  assert.equal(context.multimask_output, false);
  assert.deepEqual(context.mask_prompt_source, {
    annotation_id: source.annotation_id,
    source_version: source.source_version,
  });
  const strokes = context.scribbles as Array<{ polarity: number; points: number[][] }>;
  assert.deepEqual(
    strokes.map((stroke) => stroke.polarity),
    polarities,
  );
  assert.ok(strokes.every((stroke) => stroke.points.length >= 2));
  assert.equal(response.output_geometry, "mask");
  assert.equal(response.prompt_revision, context.prompt_revision);
  assert.equal(response.diagnostic ?? null, null, "Live scribble inference returned a diagnostic");
  assert.match(response.model_version ?? "", /sam3/i);
  assert.doesNotMatch(response.model_version ?? "", /e2e|fixture|stub|screenshot/i);
  assert.ok(typeof response.inference_time_ms === "number" && response.inference_time_ms >= 0);
  assert.equal(response.routing?.requested_backend_id, backendId);
  assert.equal(response.routing?.model_id, SMART_SCRIBBLE_MODEL);
  assert.ok(response.routing?.backend_instance_id);
  assert.equal(response.prompt_summary?.family, "scribble");
  assert.equal(
    response.prompt_summary?.positive_scribbles,
    polarities.filter((p) => p === 1).length,
  );
  assert.equal(
    response.prompt_summary?.negative_scribbles,
    polarities.filter((p) => p === 0).length,
  );
  assert.equal(response.result.length, 1, "Scribble refinement must return one native Mask");
  const candidate = response.result[0] as {
    type: string;
    candidate_id: string;
    score: number;
    value: { rle: CocoRle };
  };
  assert.equal(candidate.type, "mask");
  assert.ok(Number.isFinite(candidate.score) && candidate.score >= 0 && candidate.score <= 1);
  const mask = scribbleMaskEvidence(candidate.value.rle);
  const expectedId = createHash("sha256")
    .update(mask.content_digest)
    .update("\0")
    .update(response.prompt_revision!)
    .update("\0")
    .update("0")
    .digest("hex");
  assert.equal(candidate.candidate_id, `sha256:${expectedId}`);
  const receipt = response.accept_receipts?.[candidate.candidate_id];
  assert.ok(receipt, "The live candidate must carry a server acceptance receipt");
  // Read consistency claims only; the production accept endpoint verifies the signature.
  const claims = JSON.parse(Buffer.from(receipt.split(".")[0], "base64url").toString("utf8"));
  assert.equal(claims.task_id, source.task_id);
  assert.equal(claims.content_digest, mask.content_digest);
  assert.deepEqual(claims.prompt_source, {
    source_annotation_id: source.annotation_id,
    source_version: source.source_version,
    source_digest: source.source_digest,
  });
  assert.equal(claims.accept_target.mode, "refine");
  return {
    candidate,
    evidence: {
      prompt_revision: response.prompt_revision,
      prompt_summary: response.prompt_summary,
      routing: response.routing,
      model_version: response.model_version,
      inference_time_ms: response.inference_time_ms,
      cache_hit: response.cache_hit,
      candidate_id: candidate.candidate_id,
      mask,
      response_sha256: createHash("sha256").update(JSON.stringify(response)).digest("hex"),
    },
  };
}

/** Register every created row before assertions or later UI checks can fail. */
export function trackScribbleAcceptance(
  response: AiMaskAcceptResponse,
  cleanup: CandidateReviewCleanupRecord,
) {
  if (
    typeof response.annotation?.id === "string" &&
    !cleanup.annotationIds.includes(response.annotation.id)
  )
    cleanup.annotationIds.push(response.annotation.id);
  if (
    typeof response.prediction?.id === "string" &&
    !cleanup.predictionIds.includes(response.prediction.id)
  )
    cleanup.predictionIds.push(response.prediction.id);
}
