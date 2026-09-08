import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { recordFlowArtifact, type FlowArtifactProvenance } from "./flow-manifest.ts";

export interface PortableRecordingClip {
  startSec: number;
  durationSec: number;
}

type PortableRecordingInput = Omit<FlowArtifactProvenance, "targetPath" | "role"> & {
  runId: string;
  clip?: PortableRecordingClip;
};

export async function archivePortableRecording(
  page: Page,
  input: PortableRecordingInput,
): Promise<void> {
  if (
    !/^[a-zA-Z0-9_-]+$/.test(input.runId) ||
    !/^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(input.assetId)
  ) {
    throw new Error("Unsafe recording run or asset ID");
  }
  const video = page.video();
  if (!video) throw new Error("Portable capture requires Playwright video:on");
  const browserVersion = page.context().browser()?.version() ?? "unknown";
  const viewport = page.viewportSize();
  const root = path.join(input.repoRoot, ".artifacts/recordings", input.runId);
  const target = path.join(root, `${input.assetId}.mp4`);
  const source = path.join(root, `${input.assetId}.webm`);
  const temporary = `${target}.tmp.mp4`;
  if (
    input.clip &&
    (!Number.isFinite(input.clip.startSec) ||
      !Number.isFinite(input.clip.durationSec) ||
      input.clip.startSec < 0 ||
      input.clip.durationSec <= 0)
  ) {
    throw new Error("Portable recording clip must have a non-negative start and positive duration");
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // Preserve the complete source: Playwright's video start has no exact epoch contract.
  // An explicit clip only affects the reviewable MP4; the source WebM remains complete.
  await page.close();
  await video.saveAs(source);
  try {
    const result = spawnSync(
      process.env.FFMPEG_PATH ?? "ffmpeg",
      [
        "-y",
        "-i",
        source,
        ...(input.clip
          ? ["-ss", String(input.clip.startSec), "-t", String(input.clip.durationSec)]
          : []),
        "-an",
        "-c:v",
        "libx264",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        temporary,
      ],
      { encoding: "utf8" },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Portable encoding failed: ${result.stderr}`);
    fs.renameSync(temporary, target);
    recordFlowArtifact({
      ...input,
      targetPath: target,
      role: "docs-video",
      manifestPath: path.join(root, "manifest.json"),
      capture: {
        ...input.capture,
        profile: "docs",
        driver: "playwright",
        platform: process.platform,
        browser_version: browserVersion,
        viewport,
        trim: input.clip
          ? {
              type: "source_clip",
              start_seconds: input.clip.startSec,
              duration_seconds: input.clip.durationSec,
            }
          : "untrimmed",
        source: path.relative(input.repoRoot, source),
      },
    });
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
