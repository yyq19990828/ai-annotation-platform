import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PointCloudQualityConfig, PointCloudQualityEvaluation } from "@/api/pointCloudQuality";

const evaluationsMock = vi.hoisted(() => vi.fn());
const createMock = vi.hoisted(() => vi.fn());
const promoteMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/usePointCloudQuality", () => ({
  usePointCloudQualityEvaluations: evaluationsMock,
  useCreatePointCloudQualityEvaluation: createMock,
  usePromotePointCloudQualityEvaluation: promoteMock,
}));

import { PointCloudQualityGovernance } from "./PointCloudQualityGovernance";

const config: PointCloudQualityConfig = {
  schema_version: 2,
  config_revision: 3,
  enabled: true,
  thresholds: {
    minimum_points: 5,
    ground_sample_min: 24,
    ground_margin_m: 0.75,
    ground_penetration_m: 0.2,
    ground_float_m: 0.45,
    size_min_samples: 8,
    size_mad_z: 4.5,
    temporal_center_jump_m: 4,
    temporal_size_change_ratio: 0.6,
    temporal_yaw_jump_rad: 0.8,
  },
  enabled_rules: ["low_point_count"],
  severity_overrides: {},
  class_thresholds: {},
  governance: {
    minimum_reviewed_per_rule: 1,
    maximum_false_positive_rate: 0.1,
    minimum_confirmed_retention: 0.9,
  },
};

const metrics = {
  sample_count: 2,
  triggered_count: 1,
  confirmed: 1,
  false_positive: 0,
  accepted_exception: 0,
  uncertain: 0,
  decidable_count: 2,
  observed_precision: 1,
  observed_false_positive_rate: 0,
  confirmed_retention: 1,
};

const evaluation: PointCloudQualityEvaluation = {
  id: "evaluation-1",
  project_id: "project-1",
  created_by_id: "user-1",
  baseline_config_revision: 3,
  baseline_config_digest: "a".repeat(64),
  candidate_config_digest: "b".repeat(64),
  cutoff_at: "2026-08-26T00:00:00Z",
  sample_count: 2,
  summary: {
    changed_targets: [
      {
        code: "low_point_count",
        class_name: "car",
        status: "promote",
        reasons: [],
        baseline: { ...metrics, observed_false_positive_rate: 0.5 },
        candidate: metrics,
      },
    ],
  },
  gate_status: "promote",
  gate_reasons: [],
  promoted_by_id: null,
  promoted_at: null,
  promoted_config_revision: null,
  created_at: "2026-08-26T00:00:00Z",
};

describe("PointCloudQualityGovernance", () => {
  const createMutate = vi.fn();
  const promoteMutate = vi.fn();

  beforeEach(() => {
    createMutate.mockReset();
    promoteMutate.mockReset();
    evaluationsMock.mockReturnValue({ data: { items: [evaluation], total: 1 }, isLoading: false });
    createMock.mockReturnValue({ mutate: createMutate, isPending: false, isError: false });
    promoteMock.mockReturnValue({ mutate: promoteMutate, isPending: false, isError: false });
  });

  it("edits a class candidate, explains the proxy metric and promotes a passed snapshot", () => {
    render(
      <PointCloudQualityGovernance
        projectId="project-1"
        config={config}
        classes={["car", "pedestrian"]}
        canGovern
      />,
    );

    fireEvent.change(screen.getByLabelText("应用范围"), { target: { value: "car" } });
    fireEvent.change(screen.getByLabelText("最少点数"), { target: { value: "3" } });
    fireEvent.click(screen.getByText("生成候选评估"));
    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        config_revision: 3,
        class_thresholds: { car: { minimum_points: 3 } },
      }),
    );
    expect(screen.getByText(/不是召回率/)).toBeTruthy();
    expect(screen.getByText("误报 0%")).toBeTruthy();

    fireEvent.click(screen.getByText("晋级为项目配置"));
    expect(promoteMutate).toHaveBeenCalledWith("evaluation-1");
  });

  it("normalizes a stored revision 1 config before editing a class threshold", () => {
    const legacyConfig = {
      schema_version: 1,
      config_revision: 2,
      enabled: true,
      thresholds: config.thresholds,
      enabled_rules: ["low_point_count"],
      severity_overrides: {},
    } as unknown as PointCloudQualityConfig;

    render(
      <PointCloudQualityGovernance
        projectId="project-1"
        config={legacyConfig}
        classes={["car"]}
        canGovern
      />,
    );

    fireEvent.change(screen.getByLabelText("应用范围"), { target: { value: "car" } });
    fireEvent.change(screen.getByLabelText("最少点数"), { target: { value: "4" } });
    fireEvent.click(screen.getByText("生成候选评估"));

    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        schema_version: 2,
        config_revision: 2,
        class_thresholds: { car: { minimum_points: 4 } },
        governance: {
          minimum_reviewed_per_rule: 20,
          maximum_false_positive_rate: 0.1,
          minimum_confirmed_retention: 0.9,
        },
      }),
    );
  });
});
