import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  extractImageReferences,
  resolveImageReference,
} from "./image-reference-utils.mjs";
import { normalizeScreenshotManifest } from "./screenshot-manifest-utils.mjs";

const repoRoot = "/repo";
const docsRoot = "/repo/docs-site";
const mdPath = "/repo/docs-site/user-guide/projects/index.md";

test("extracts Markdown, img and AutoImage references", () => {
  assert.deepEqual(
    extractImageReferences(`
![A](../images/a.png)
<img src="../images/b.png" />
<AutoImage src="projects/c.png" alt="C" />
`),
    [
      { src: "../images/a.png", kind: "markdown" },
      { src: "../images/b.png", kind: "markdown" },
      { src: "projects/c.png", kind: "auto-image" },
    ],
  );
});

test("resolves AutoImage paths from the shared user-guide image root", () => {
  const resolved = resolveImageReference({
    src: "projects/c.png",
    kind: "auto-image",
    mdPath,
    repoRoot,
    docsRoot,
  });
  assert.equal(resolved?.absolute, path.normalize("/repo/docs-site/user-guide/images/projects/c.png"));
  assert.equal(resolved?.key, "docs-site/user-guide/images/projects/c.png");
});

test("normalizes both legacy and current manifest shapes", () => {
  assert.deepEqual(normalizeScreenshotManifest({ "a.png": { auto: true } }).entries, {
    "a.png": { auto: true },
  });
  assert.deepEqual(
    normalizeScreenshotManifest({ schema_version: 2, entries: { "b.png": { auto: false } } })
      .entries,
    { "b.png": { auto: false } },
  );
});
