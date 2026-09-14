import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UserAvatar } from "./UserAvatar";

/** Radix 用 `new window.Image()` 探测是否加载成功;用可控替身把状态推到 loaded/error。 */
function stubImage({ naturalWidth }: { naturalWidth: number }) {
  class FakeImage {
    complete = true;
    naturalWidth = naturalWidth;
    crossOrigin: string | null = null;
    referrerPolicy = "";
    src = "";
    addEventListener() {}
    removeEventListener() {}
  }
  vi.stubGlobal("Image", FakeImage);
}

describe("UserAvatar", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("无头像引用时渲染首字母回退", () => {
    render(<UserAvatar user={{ id: "u1", name: "张三", avatar_ref: null }} />);
    expect(screen.getByText("张")).toBeInTheDocument();
  });

  it("引用为空/null 时不渲染 img", () => {
    const { container } = render(<UserAvatar user={{ name: "Ann", avatar_ref: "" }} />);
    expect(container.querySelector("img")).toBeNull();
  });

  it("内置像素头像渲染静态 SVG 路径", () => {
    stubImage({ naturalWidth: 64 });
    const { container } = render(
      <UserAvatar user={{ name: "Ann", avatar_ref: "preset:pixel-07" }} />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("src", "/avatars/pixel/pixel-07.svg");
    // 姓名已在旁侧展示,头像不重复播报。
    expect(img).toHaveAttribute("aria-hidden", "true");
  });

  it("上传头像渲染后端能力 URL", () => {
    stubImage({ naturalWidth: 64 });
    const token = "0123456789abcdef0123456789abcdef";
    const { container } = render(
      <UserAvatar user={{ name: "Ann", avatar_ref: `upload:${token}` }} />,
    );
    expect(container.querySelector("img")).toHaveAttribute("src", `/api/v1/avatars/${token}`);
  });

  it("图片加载失败时回退首字母", () => {
    stubImage({ naturalWidth: 0 });
    render(<UserAvatar user={{ name: "Ann", avatar_ref: "preset:pixel-03" }} />);
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("优先使用后端下发的 avatar_initial", () => {
    render(<UserAvatar user={{ name: "ann", avatar_initial: "甲", avatar_ref: null }} />);
    expect(screen.getByText("甲")).toBeInTheDocument();
  });

  it("畸形引用不产生 img(不把任意字符串拼进 src)", () => {
    stubImage({ naturalWidth: 64 });
    const { container } = render(
      <UserAvatar user={{ name: "Ann", avatar_ref: "preset:../../evil" }} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("A")).toBeInTheDocument();
  });
});
