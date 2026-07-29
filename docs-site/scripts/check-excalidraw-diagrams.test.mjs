import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { deflateSync } from "node:zlib";
import { checkExcalidrawDiagrams } from "./check-excalidraw-diagrams.mjs";

function withFixture(run) {
  const docsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "excalidraw-diagrams-"));
  fs.mkdirSync(path.join(docsRoot, "public/diagrams/dev"), { recursive: true });
  try {
    return run(docsRoot);
  } finally {
    fs.rmSync(docsRoot, { recursive: true, force: true });
  }
}

function writeValidSvg(docsRoot, relative = "dev/system-overview.svg") {
  const target = path.join(docsRoot, "public/diagrams", relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const scene = JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "https://excalidraw.com",
    elements: [],
    appState: { viewBackgroundColor: "#ffffff" },
    files: {},
  });
  const envelope = JSON.stringify({
    version: "1",
    encoding: "bstring",
    compressed: true,
    encoded: deflateSync(scene).toString("latin1"),
  });
  const payload = Buffer.from(envelope, "latin1").toString("base64");
  fs.writeFileSync(
    target,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">
<!-- svg-source:excalidraw -->
<metadata>
<!-- payload-type:application/vnd.excalidraw+json -->
<!-- payload-start -->${payload}<!-- payload-end -->
</metadata>
<defs><style>@font-face{font-family:"Virgil";src:url("data:font/woff2;base64,AA==")}</style></defs>
<text font-family="Virgil">System</text>
</svg>`,
  );
}

test("accepts a referenced self-contained Excalidraw SVG", () =>
  withFixture((docsRoot) => {
    writeValidSvg(docsRoot);
    fs.mkdirSync(path.join(docsRoot, "dev"));
    fs.writeFileSync(
      path.join(docsRoot, "dev/overview.md"),
      '<ExcalidrawDiagram src="/diagrams/dev/system-overview.svg" alt="系统架构" />',
    );

    const result = checkExcalidrawDiagrams(docsRoot);
    assert.deepEqual(result.failures, []);
  }));

test("reports missing assets and ignores component examples in fenced code", () =>
  withFixture((docsRoot) => {
    fs.mkdirSync(path.join(docsRoot, "dev"));
    fs.writeFileSync(
      path.join(docsRoot, "dev/guide.md"),
      `\`\`\`md
<ExcalidrawDiagram src="/diagrams/dev/example.svg" alt="示例" />
\`\`\`

<ExcalidrawDiagram src="/diagrams/dev/missing.svg" alt="缺失图" />`,
    );

    const result = checkExcalidrawDiagrams(docsRoot);
    assert.equal(result.references.has("dev/example.svg"), false);
    assert.equal(
      result.failures.some((failure) => failure.includes("dev/missing.svg")),
      true,
    );
  }));

test("rejects SVGs without embedded scene and Virgil font", () =>
  withFixture((docsRoot) => {
    const target = path.join(docsRoot, "public/diagrams/dev/incomplete.svg");
    fs.writeFileSync(target, '<svg viewBox="0 0 10 10"></svg>');
    fs.mkdirSync(path.join(docsRoot, "dev"));
    fs.writeFileSync(
      path.join(docsRoot, "dev/overview.md"),
      '<ExcalidrawDiagram src="/diagrams/dev/incomplete.svg" alt="不完整" />',
    );

    const failures = checkExcalidrawDiagrams(docsRoot).failures.join("\n");
    assert.match(failures, /scene payload/);
    assert.match(failures, /Virgil/);
    assert.match(failures, /svg-source:excalidraw/);
  }));
