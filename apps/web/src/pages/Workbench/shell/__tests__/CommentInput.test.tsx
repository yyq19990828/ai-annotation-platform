/**
 * v0.6.6 · CommentInput.serialize 单元测试。
 *
 * 覆盖 ROADMAP 列出的 4 类边界：
 *  - chip 紧邻 chip：两个 mention 直接相连，offset 不能错位
 *  - chip 在 block 元素首尾：div / p 包裹时换行注入正确
 *  - 普通文本 + chip 混合：base 路径
 *  - 仅文本（无 chip）：mentions 为空
 */
import { describe, it, expect } from "vitest";
import { serialize } from "../CommentInput";

function makeRoot(html: string): HTMLElement {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
}

describe("CommentInput.serialize", () => {
  it("纯文本无 chip → body 等于文本，mentions 空", () => {
    const root = makeRoot("hello world");
    const { body, mentions } = serialize(root);
    expect(body).toBe("hello world");
    expect(mentions).toEqual([]);
  });

  it("单个 chip + 后续文本 → mention offset/length 正确", () => {
    const root = makeRoot(
      '<span data-mention-uid="u1" data-mention-name="alice">@alice</span> hi',
    );
    const { body, mentions } = serialize(root);
    expect(body).toBe("@alice hi");
    expect(mentions).toEqual([
      { userId: "u1", displayName: "alice", offset: 0, length: 6 },
    ]);
  });

  it("chip 紧邻 chip（无中间文本） → 两个 mention 偏移连续", () => {
    const root = makeRoot(
      '<span data-mention-uid="u1" data-mention-name="alice">@alice</span>' +
      '<span data-mention-uid="u2" data-mention-name="bob">@bob</span>',
    );
    const { body, mentions } = serialize(root);
    expect(body).toBe("@alice@bob");
    expect(mentions).toEqual([
      { userId: "u1", displayName: "alice", offset: 0, length: 6 },
      { userId: "u2", displayName: "bob", offset: 6, length: 4 },
    ]);
  });

  it("chip 在 block 元素首尾 → 块间换行注入不污染 mention offset", () => {
    const root = makeRoot(
      '<div><span data-mention-uid="u1" data-mention-name="alice">@alice</span></div>' +
      '<div>line2</div>',
    );
    const { body, mentions } = serialize(root);
    expect(body).toBe("@alice\nline2");
    expect(mentions[0]).toEqual({
      userId: "u1",
      displayName: "alice",
      offset: 0,
      length: 6,
    });
  });

  it("BR 节点转换为换行", () => {
    const root = makeRoot("line1<br>line2");
    const { body } = serialize(root);
    expect(body).toBe("line1\nline2");
  });

  it("mention chip data-mention-name 缺失时回退到 textContent", () => {
    const root = makeRoot('<span data-mention-uid="u1">@fallback</span>');
    const { body, mentions } = serialize(root);
    // textContent = "@fallback"，name = "@fallback"，导出 text = "@@fallback"
    expect(mentions[0].userId).toBe("u1");
    expect(mentions[0].displayName).toBe("@fallback");
    expect(body.startsWith("@@fallback")).toBe(true);
  });
});
