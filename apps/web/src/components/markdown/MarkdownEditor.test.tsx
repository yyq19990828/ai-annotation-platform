import { describe, expect, it } from "vitest";

import {
  imagePlaceholderMarkdown,
  resolveUploadedImageAlt,
  stripPendingImageNodes,
} from "./MarkdownEditor";

describe("MarkdownEditor upload markers", () => {
  it("keeps the retry placeholder alt empty until reconciliation", () => {
    expect(imagePlaceholderMarkdown("markdown-upload-pending:retry")).toBe(
      "![](markdown-upload-pending:retry)",
    );
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
});
