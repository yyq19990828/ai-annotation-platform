// v0.19.4 · ModelCard 能力徽标: batchable / device 语义徽标 + supported_inputs 可接受输入行。
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ModelCard } from "./ModelCard";
import type { FlatModel } from "./types";
import type { MLModelCapability } from "@/api/ml-backends";

function makeItem(model: Partial<MLModelCapability>): FlatModel {
  return {
    model: { id: "m1", display_name: "Model 1", task: "detection", ...model },
    backendId: "instance:bk",
    backendName: "bk",
    projectId: "",
    projectName: "平台内置",
    source: "env_only",
    registeredProjects: [],
    stale: false,
  };
}

function renderCard(model: Partial<MLModelCapability>) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <ModelCard item={makeItem(model)} />
    </QueryClientProvider>,
  );
}

describe("ModelCard 能力徽标 (v0.19.4)", () => {
  it("batchable=true + supported_inputs → 可批量 + 整图/裁剪徽标", () => {
    renderCard({
      resource_profile: { batchable: true, device: "gpu" },
      supported_inputs: ["full_image", "crop"],
    });
    expect(screen.getByText("可批量")).toBeInTheDocument();
    expect(screen.getByText("GPU")).toBeInTheDocument();
    expect(screen.getByText("整图")).toBeInTheDocument();
    expect(screen.getByText("裁剪")).toBeInTheDocument();
    // 已升级为徽标的 batchable/device 不再以裸 k:v 重复出现在资源行。
    expect(screen.queryByText(/batchable:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/device:/)).not.toBeInTheDocument();
  });

  it("batchable=false → 交互/有状态徽标", () => {
    renderCard({ resource_profile: { batchable: false } });
    expect(screen.getByText("交互/有状态")).toBeInTheDocument();
    expect(screen.queryByText("可批量")).not.toBeInTheDocument();
  });

  it("老 backend (空 resource_profile / 无 supported_inputs) → 不显示批量徽标, 不报错", () => {
    renderCard({ resource_profile: {}, supported_inputs: [] });
    expect(screen.queryByText("可批量")).not.toBeInTheDocument();
    expect(screen.queryByText("交互/有状态")).not.toBeInTheDocument();
    // 可接受输入行无数据 → 回落「整图」占位。
    expect(screen.getByText("整图")).toBeInTheDocument();
  });

  it("supported_inputs=video → 使用词表标签", () => {
    renderCard({ supported_inputs: ["video"] });
    expect(screen.getByText("视频")).toBeInTheDocument();
  });
});
