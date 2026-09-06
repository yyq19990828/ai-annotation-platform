#!/usr/bin/env node
// Article presets share the same source validation, encoder, and provenance path as site media.
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { deriveMedia, parseClip } from "../apps/web/scripts/media-derivation.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTICLES = {
  "06-video-track": {
    output: "docs/articles/media/06-video-track",
    assets: {
      "video-track": { fps: 10, width: 800, coverAt: 8 },
      "video-draw": { fps: 15, width: 1280, coverAt: 8 },
      "current-frame-video-inference": { fps: 15, width: 1280, coverAt: 18 },
      "video-propagate-track-vs-copy": { fps: 15, width: 1280, coverAt: 17 },
      "video-tracker-text-discovery": { fps: 15, width: 1280, coverAt: 12 },
      "video-tracker-positive-negative": {
        fps: 10,
        width: 800,
        coverAt: 24,
        trim: [4.5, 30.5],
      },
      "video-track-batch-propagate": { fps: 15, width: 1280, coverAt: 8 },
    },
  },
};

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    archive: { type: "string" },
    article: { type: "string" },
    asset: { type: "string", multiple: true },
    quality: { type: "string", default: "marketing" },
    clip: { type: "string" },
  },
});
const articleIds = values.article ? [values.article] : Object.keys(ARTICLES);
for (const id of articleIds)
  if (!Object.hasOwn(ARTICLES, id)) throw new Error(`Unknown article: ${id}`);
const known = [...new Set(articleIds.flatMap((id) => Object.keys(ARTICLES[id].assets)))];
const assets = values.asset ?? known;
for (const id of assets)
  if (!known.includes(id)) throw new Error(`Article does not contain asset: ${id}`);
deriveMedia({
  repoRoot: REPO_ROOT,
  runDirectory: path.resolve(values.archive ?? path.join(os.homedir(), "Desktop", "AAP资产")),
  quality: values.quality,
  assets,
  clip: parseClip(values.clip),
  outputs(assetId) {
    return articleIds.flatMap((id) => {
      const article = ARTICLES[id];
      const config = article.assets[assetId];
      if (!config) return [];
      const common = { watchPaths: ["scripts/derive-article-media.mjs"] };
      return [
        {
          ...common,
          target: `${article.output}/${assetId}.gif`,
          kind: "gif",
          role: "docs-gif",
          fps: config.fps,
          width: config.width,
          height: Number.MAX_SAFE_INTEGER,
          budgetBytes: 8 * 1024 * 1024,
          clip: config.trim
            ? { start: config.trim[0], duration: config.trim[1] - config.trim[0] }
            : undefined,
        },
        {
          ...common,
          target: `${article.output}/${assetId}-cover.png`,
          kind: "png",
          role: "poster",
          width: 1600,
          height: Number.MAX_SAFE_INTEGER,
          posterAt: config.coverAt,
        },
      ];
    });
  },
});
