// v0.14.11 · ProtocolCapabilityCard 单测.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ProtocolTask } from "@/api/mlCapabilities";
import { ProtocolCapabilityCard, type MountedModel } from "./ProtocolCapabilityCard";

function makeTask(overrides: Partial<ProtocolTask> = {}): ProtocolTask {
  return {
    id: "ocr",
    label: "OCR",
    summary: "从图像中提取文本框与文本内容。",
    default_geometry: ["bbox"],
    default_modalities: ["image"],
    typical_models: ["PaddleOCR", "RapidOCR"],
    protocol_notes: "...",
    suggested_backends: [
      {
        name: "PaddleOCR",
        repo_url: "https://github.com/PaddlePaddle/PaddleOCR",
        summary: "Paddle 系 OCR。",
        research_link: null,
        infra: "paddle",
        builtin: false,
      },
    ],
    ...overrides,
  };
}

function makeMounted(overrides: Partial<MountedModel> = {}): MountedModel {
  return {
    id: "yolov8",
    display_name: "YOLOv8 检测",
    infra: "pytorch",
    is_interactive: false,
    backendName: "prod-yolo",
    source: "registered",
    ...overrides,
  };
}

const noopLabel = (v: string) => v;

describe("ProtocolCapabilityCard", () => {
  it("0 model 时显示「暂无接入」徽标 + 推荐 backend 列表", () => {
    render(
      <ProtocolCapabilityCard
        task={makeTask()}
        mounted={[]}
        infraLabel={noopLabel}
        modalityLabel={noopLabel}
      />,
    );
    expect(screen.getByText("暂无接入")).toBeInTheDocument();
    expect(screen.getByText("PaddleOCR")).toBeInTheDocument();
    expect(screen.getByText("Paddle 系 OCR。")).toBeInTheDocument();
    expect(screen.getByText(/PaddleOCR \/ RapidOCR/)).toBeInTheDocument();
  });

  it("N model 时显示「N 个模型已接入」并渲染 model 子卡", () => {
    render(
      <ProtocolCapabilityCard
        task={makeTask({ id: "detection", label: "目标检测" })}
        mounted={[makeMounted(), makeMounted({ id: "yolov8n", display_name: "YOLOv8n", backendName: "prod-yolo-2" })]}
        infraLabel={noopLabel}
        modalityLabel={noopLabel}
      />,
    );
    expect(screen.getByText("2 个模型已接入")).toBeInTheDocument();
    expect(screen.getByText("YOLOv8 检测")).toBeInTheDocument();
    expect(screen.queryByText("暂无接入")).not.toBeInTheDocument();
  });

  it("点击「去注册」CTA 触发 onGoToRegistry 回调", () => {
    const onGoToRegistry = vi.fn();
    render(
      <ProtocolCapabilityCard
        task={makeTask()}
        mounted={[]}
        infraLabel={noopLabel}
        modalityLabel={noopLabel}
        onGoToRegistry={onGoToRegistry}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /去注册/ }));
    expect(onGoToRegistry).toHaveBeenCalledTimes(1);
  });

  it("env_only model 显示「自带」徽标; registered 显示「已注册」徽标", () => {
    render(
      <ProtocolCapabilityCard
        task={makeTask({ id: "detection" })}
        mounted={[
          makeMounted({ id: "m-env", source: "env_only", backendName: "gsam2" }),
          makeMounted({ id: "m-reg", source: "registered", backendName: "sam3.1" }),
        ]}
        infraLabel={noopLabel}
        modalityLabel={noopLabel}
      />,
    );
    expect(screen.getByText("自带")).toBeInTheDocument();
    expect(screen.getByText("已注册")).toBeInTheDocument();
  });
});
