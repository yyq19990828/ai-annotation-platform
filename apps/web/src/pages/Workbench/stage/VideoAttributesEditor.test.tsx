import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AttributeSchema } from "@/api/projects";

import { VideoAttributesEditor } from "./VideoAttributesEditor";

const schema: AttributeSchema = {
  fields: [
    {
      key: "state",
      label: "状态",
      type: "select",
      mutable: true,
      options: [{ value: "open", label: "开" }],
    },
    { key: "team", label: "队伍", type: "text", mutable: false },
  ],
};

function renderEditor(overrides: Partial<React.ComponentProps<typeof VideoAttributesEditor>> = {}) {
  return render(
    <VideoAttributesEditor
      schema={schema}
      className="car"
      trackAttributes={{}}
      keyframeAttributes={undefined}
      frameIndex={7}
      canEditKeyframe
      onChangeTrackAttributes={vi.fn()}
      onChangeKeyframeAttributes={vi.fn()}
      {...overrides}
    />,
  );
}

describe("VideoAttributesEditor", () => {
  it("仅当存在 mutable 字段时渲染, 否则返回 null", () => {
    const { container } = render(
      <VideoAttributesEditor
        schema={{ fields: [{ key: "team", label: "队伍", type: "text", mutable: false }] }}
        className="car"
        trackAttributes={{}}
        keyframeAttributes={undefined}
        frameIndex={0}
        canEditKeyframe
        onChangeTrackAttributes={vi.fn()}
        onChangeKeyframeAttributes={vi.fn()}
      />,
    );
    expect(container.querySelector("[data-testid='video-attributes-editor']")).toBeNull();
  });

  it("渲染轨迹默认值 + 当前帧覆盖两层, 标注当前帧号", () => {
    renderEditor();
    expect(screen.getByTestId("video-attributes-editor")).toBeTruthy();
    expect(screen.getByText("轨迹默认值")).toBeTruthy();
    expect(screen.getByText("当前帧覆盖")).toBeTruthy();
    expect(screen.getByText("仅 F7 生效")).toBeTruthy();
  });

  it("无可写关键帧时禁止逐帧覆盖", () => {
    renderEditor({ canEditKeyframe: false });
    expect(screen.getByText("当前帧无关键帧, 无法设置逐帧覆盖")).toBeTruthy();
  });

  it("已有覆盖时展示覆盖项计数", () => {
    renderEditor({ keyframeAttributes: { state: "open" } });
    expect(screen.getByText(/已覆盖 1 项/)).toBeTruthy();
  });
});
