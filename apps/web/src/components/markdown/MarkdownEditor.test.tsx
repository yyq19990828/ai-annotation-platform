import { describe, expect, it } from "vitest";

import {
  imagePlaceholderMarkdown,
  replacePendingImageNode,
  resolveUploadedImageAlt,
  stripPendingImageNodes,
} from "./MarkdownEditor";

describe("MarkdownEditor upload markers", () => {
  it("keeps the retry placeholder alt empty until reconciliation", () => {
    expect(imagePlaceholderMarkdown("markdown-upload-pending:retry")).toBe(
      "![](markdown-upload-pending:retry)",
    );
  });

  it("keeps a retained retry marker out of the draft after surrounding text changes", () => {
    const source = "markdown-upload-pending:retry";
    expect(stripPendingImageNodes(`新前![](${source})后`, [])).toBe("新前后");
  });

  it("reconciles a source-mode retry without discarding edited text or alt", () => {
    const source = "markdown-upload-pending:source-retry";
    const result = replacePendingImageNode(
      `新前![人工描述](${source})后`,
      source,
      { src: "guide-asset:resolved.png", alt: "服务器描述" },
      "本地文件.png",
    );
    expect(result).toEqual({
      markdown: "新前![人工描述](<guide-asset:resolved.png>)后",
      replaced: true,
    });
  });

  it("escapes fallback alt text and destinations that need CommonMark delimiters", () => {
    const source = "markdown-upload-pending:source-special";
    expect(
      replacePendingImageNode(
        `![](${source})`,
        source,
        { src: "guide-asset:projects/demo/screen shot[1].png" },
        "screen shot[1].png",
      ),
    ).toEqual({
      markdown: "![screen shot\\[1\\].png](<guide-asset:projects/demo/screen shot[1].png>)",
      replaced: true,
    });
  });

  it("preserves an alt edited while the upload is in flight", () => {
    expect(resolveUploadedImageAlt("人工描述", "upload.png", "服务器描述")).toBe("人工描述");
    expect(resolveUploadedImageAlt("", "upload.png")).toBe("upload.png");
  });

  it("removes a pending image even when its alt text contains an escaped bracket", () => {
    const source = "markdown-upload-pending:alt-bracket";
    const draft = `前文
![上传\\]中](${source})
后文`;

    expect(stripPendingImageNodes(draft, [source])).toBe(`前文

后文`);
  });

  it("removes internal destinations after source edits break the image syntax", () => {
    const source = "markdown-upload-pending:broken-source";
    const draft = ["前[](", source, ")中(", source, ")后 ", source].join("");
    expect(stripPendingImageNodes(draft, [source])).toBe("前中后 ");
  });
});
