import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  checked,
  deriveMedia,
  outputGeometry,
  parseClip,
  readArchive,
  selectArchiveAssets,
} from "./media-derivation.mjs";
import { recordFlowArtifact } from "../e2e/screenshots/_helpers/flow-manifest.ts";

function fixture(root) {
  const run = path.join(root, ".artifacts/recordings/run");
  fs.mkdirSync(run, { recursive: true });
  const file = path.join(run, "bbox-draw.mp4");
  checked("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=320x180:r=25:d=2",
    "-c:v",
    "libx264",
    "-threads",
    "2",
    file,
  ]);
  recordFlowArtifact({
    repoRoot: root,
    targetPath: file,
    assetId: "bbox-draw",
    role: "docs-video",
    source: "flow.ts",
    capturedCommit: "test-commit",
    sourceWorktreeDirty: true,
    seedRevision: "seed",
    testTitle: "capture",
    manifestPath: path.join(run, "manifest.json"),
    capture: {
      profile: "docs",
      inference: "none",
      gif_variants: [
        {
          target: "docs-site/user-guide/images/bbox/test.gif",
          fps: 4,
          maxWidth: 640,
          startSec: 0.4,
          durationSec: 0.8,
        },
      ],
    },
  });
  return { run, file };
}

test("one archive derives every format, preserves unrelated entries, and never upscales standard sources", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aap-derive-test-"));
  try {
    const { run, file } = fixture(root);
    assert.equal(readArchive(run).get("bbox-draw").quality, "standard");
    const mixed = new Map([
      ["bbox-draw", { gifs: [{}] }],
      ["video-track", { gifs: [] }],
    ]);
    assert.deepEqual(
      selectArchiveAssets(mixed, undefined, "gif", () => true),
      ["bbox-draw"],
    );
    assert.deepEqual(
      selectArchiveAssets(mixed, ["video-track"], "gif", () => true),
      ["video-track"],
    );
    assert.deepEqual(outputGeometry({ width: 320, height: 180, fps: 25 }), {
      width: 320,
      height: 180,
      fps: 25,
    });
    assert.throws(() => parseClip("-1:3"), /--clip/);
    assert.throws(() => parseClip("0:Infinity"), /--clip/);
    const options = {
      repoRoot: root,
      runDirectory: run,
      quality: "standard",
      assets: ["bbox-draw"],
      clip: parseClip("0.2:1"),
      outputs: () => [
        { target: "docs-site/public/media/test.mp4", kind: "mp4", role: "docs-video" },
        { target: "docs-site/public/home/test.webm", kind: "webm", role: "home-video" },
        { target: "docs-site/public/media/test-poster.webp", kind: "webp", role: "poster" },
        { target: "docs/articles/media/test-cover.png", kind: "png", role: "poster" },
        {
          target: "docs-site/user-guide/images/bbox/test.gif",
          kind: "gif",
          role: "docs-gif",
          raw: true,
          fps: 4,
          clip: { start: 0.4, duration: 0.8 },
        },
      ],
    };
    deriveMedia(options);
    const manifestPath = path.join(root, "apps/web/e2e/screenshots/outputs/flow-manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const video = manifest.entries["docs-site/public/media/test.mp4"];
    assert.equal(video.media.width, 320);
    assert.equal(video.media.fps, "25/1");
    assert.equal(video.source_asset.quality, "standard");
    assert.equal(video.capture.source_inference, "none");
    assert.deepEqual(video.source_asset.clip, { start: 0.2, duration: 1 });
    assert.deepEqual(
      manifest.entries["docs-site/user-guide/images/bbox/test.gif"].source_asset.clip,
      { start: 0.2, duration: 1 },
    );
    deriveMedia({
      ...options,
      clip: { start: 0.4, duration: 0.8 },
      outputs: () => [options.outputs()[4]],
    });
    assert.deepEqual(
      JSON.parse(fs.readFileSync(manifestPath, "utf8")).entries[
        "docs-site/user-guide/images/bbox/test.gif"
      ].source_asset.clip,
      { start: 0.4, duration: 0.8 },
    );
    assert.deepEqual(
      JSON.parse(fs.readFileSync(manifestPath, "utf8")).entries["docs-site/public/media/test.mp4"],
      video,
    );
    const before = fs.readFileSync(manifestPath, "utf8");
    assert.throws(() => deriveMedia({ ...options, clip: undefined }), /reviewed --clip/);
    assert.throws(() => deriveMedia({ ...options, quality: "marketing" }), /quality\/provenance/);
    assert.throws(() => deriveMedia({ ...options, clip: { start: 1, duration: 5 } }), /outside/);
    assert.throws(() => deriveMedia({ ...options, assets: ["missing"] }), /lacks/);
    assert.throws(
      () =>
        deriveMedia({
          ...options,
          outputs: () => [{ ...options.outputs()[0], target: "../escape.mp4" }],
        }),
      /target/,
    );
    // The complete request is validated before any derivative is installed.
    assert.throws(
      () =>
        deriveMedia({
          ...options,
          outputs: () => [
            options.outputs()[0],
            { ...options.outputs()[4], target: "../escape.gif" },
          ],
        }),
      /target/,
    );
    assert.throws(
      () =>
        deriveMedia({
          ...options,
          outputs: () => [
            options.outputs()[4],
            { ...options.outputs()[4], target: "docs-site/user-guide/images/bbox/another.gif" },
          ],
        }),
      /multiple GIF windows/,
    );
    assert.equal(fs.readFileSync(manifestPath, "utf8"), before);
    fs.appendFileSync(file, "corruption");
    assert.throws(() => deriveMedia(options), /checksum mismatch/);
    assert.equal(fs.readFileSync(manifestPath, "utf8"), before);
    assert.ok(!fs.existsSync(path.join(root, "docs-site/maintainers/media-reviews.json")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("legacy schema-4 masters retain their quality gate and derive through the same encoder", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aap-master-derive-test-"));
  try {
    const run = path.join(root, "master");
    fs.mkdirSync(run);
    const file = path.join(run, "master.mp4");
    checked("ffmpeg", [
      "-y",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=yellow:s=3840x2160:r=60:d=0.5",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-threads",
      "2",
      file,
    ]);
    const info = {
      file: "master.mp4",
      sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
    };
    const manifest = {
      schema_version: 4,
      run: { id: "master", source_commit: "test", source_worktree_dirty: false },
      entries: {
        "bbox-draw": {
          asset_id: "bbox-draw",
          source: "flow.ts",
          files: { universal_mp4: info, capture_source: info },
          capture: {
            driver: "x11grab",
            cadence: { effective_unique_fps: 60, unique_frame_ratio: 1 },
          },
        },
      },
    };
    fs.writeFileSync(path.join(run, "manifest.json"), JSON.stringify(manifest));
    const options = {
      repoRoot: root,
      runDirectory: run,
      assets: ["bbox-draw"],
      outputs: () => [
        { target: "docs-site/public/media/master.mp4", kind: "mp4", role: "docs-video" },
      ],
    };
    deriveMedia(options);
    const result = JSON.parse(
      fs.readFileSync(
        path.join(root, "apps/web/e2e/screenshots/outputs/flow-manifest.json"),
        "utf8",
      ),
    );
    assert.equal(result.entries["docs-site/public/media/master.mp4"].media.width, 1280);
    assert.equal(
      result.entries["docs-site/public/media/master.mp4"].source_asset.quality,
      "marketing",
    );
    manifest.entries["bbox-draw"].capture.cadence.unique_frame_ratio = 0.1;
    fs.writeFileSync(path.join(run, "manifest.json"), JSON.stringify(manifest));
    assert.throws(() => deriveMedia(options), /qualified 4K60/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
