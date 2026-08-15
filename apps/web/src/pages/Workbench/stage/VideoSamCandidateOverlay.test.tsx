import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VideoSamCandidateOverlay } from "./VideoSamCandidateOverlay";

describe("VideoSamCandidateOverlay", () => {
  it("把视频负点渲染成比正点更醒目的红底白叉", () => {
    render(
      <VideoSamCandidateOverlay
        candidates={[]}
        activeIdx={0}
        sessionPoints={[
          { pt: [0.2, 0.3], polarity: 1, obj: 1 },
          { pt: [0.7, 0.6], polarity: 0, obj: 2 },
        ]}
        width={1_000}
        height={800}
        scale={1}
      />,
    );

    const positive = document.querySelector('[data-konva="Circle"][data-fill="#22c55e"]');
    const negative = document.querySelector('[data-konva="Circle"][data-fill="#ef4444"]');
    const negativeCross = document.querySelectorAll('[data-konva="Line"][data-stroke="#ffffff"]');

    expect(positive).toHaveAttribute("data-radius", "4");
    expect(negative).toHaveAttribute("data-radius", "6");
    expect(negativeCross).toHaveLength(2);
  });
});
