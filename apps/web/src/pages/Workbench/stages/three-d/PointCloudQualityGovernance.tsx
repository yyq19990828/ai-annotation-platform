import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, FlaskConical } from "lucide-react";

import type {
  PointCloudQualityConfig,
  PointCloudQualityEvaluation,
  PointCloudQualityThresholdConfig,
} from "@/api/pointCloudQuality";
import { Button } from "@/components/ui/Button";
import {
  useCreatePointCloudQualityEvaluation,
  usePointCloudQualityEvaluations,
  usePromotePointCloudQualityEvaluation,
} from "@/hooks/usePointCloudQuality";
import { cn } from "@/lib/utils";

const RULE_LABEL: Record<string, string> = {
  low_point_count: "框内点数过少",
  size_outlier: "尺寸异常",
  ground_clearance: "穿地或悬浮",
  temporal_jump: "时序跳变",
};

const REASON_LABEL: Record<string, string> = {
  candidate_unchanged: "候选阈值没有变化",
  minimum_reviewed_not_met: "可判定样本不足",
  maximum_false_positive_rate_exceeded: "观察误报率超过门限",
  minimum_confirmed_retention_not_met: "已确认问题保留率不足",
};

const THRESHOLD_FIELDS: Array<{
  key: keyof PointCloudQualityThresholdConfig;
  label: string;
  step: number;
}> = [
  { key: "minimum_points", label: "最少点数", step: 1 },
  { key: "size_mad_z", label: "尺寸 MAD z", step: 0.1 },
  { key: "ground_penetration_m", label: "穿地容差 m", step: 0.05 },
  { key: "ground_float_m", label: "悬浮容差 m", step: 0.05 },
  { key: "temporal_center_jump_m", label: "中心跳变 m/帧", step: 0.1 },
  { key: "temporal_size_change_ratio", label: "尺寸变化比例", step: 0.05 },
  { key: "temporal_yaw_jump_rad", label: "Yaw 跳变 rad/帧", step: 0.05 },
];

const DEFAULT_CONFIG: PointCloudQualityConfig = {
  schema_version: 2,
  config_revision: 1,
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
  enabled_rules: [
    "duplicate_track_member",
    "ground_clearance",
    "low_point_count",
    "size_outlier",
    "temporal_jump",
    "track_gap",
    "track_identity_drift",
  ],
  severity_overrides: {},
  class_thresholds: {},
  governance: {
    minimum_reviewed_per_rule: 20,
    maximum_false_positive_rate: 0.1,
    minimum_confirmed_retention: 0.9,
  },
};

function cloneConfig(config?: PointCloudQualityConfig | null): PointCloudQualityConfig {
  const source = config ?? DEFAULT_CONFIG;
  return {
    ...DEFAULT_CONFIG,
    ...source,
    schema_version: 2,
    thresholds: {
      ...DEFAULT_CONFIG.thresholds,
      ...source.thresholds,
    },
    enabled_rules: [...(source.enabled_rules ?? DEFAULT_CONFIG.enabled_rules)],
    severity_overrides: { ...(source.severity_overrides ?? {}) },
    class_thresholds: Object.fromEntries(
      Object.entries(source.class_thresholds ?? {}).map(([className, thresholds]) => [
        className,
        { ...thresholds },
      ]),
    ),
    governance: {
      ...DEFAULT_CONFIG.governance,
      ...source.governance,
    },
  };
}

function rate(value: number | null): string {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
}

function gateLabel(evaluation: PointCloudQualityEvaluation): string {
  if (evaluation.promoted_at) return `已晋级 r${evaluation.promoted_config_revision}`;
  if (evaluation.gate_status === "promote") return "可晋级";
  if (evaluation.gate_status === "insufficient_data") return "样本不足";
  return "暂缓";
}

interface PointCloudQualityGovernanceProps {
  projectId: string;
  config?: PointCloudQualityConfig | null;
  classes: string[];
  canGovern: boolean;
}

export function PointCloudQualityGovernance({
  projectId,
  config,
  classes,
  canGovern,
}: PointCloudQualityGovernanceProps) {
  const [scope, setScope] = useState("__global__");
  const [candidate, setCandidate] = useState(() => cloneConfig(config));
  const evaluationsQuery = usePointCloudQualityEvaluations(projectId);
  const createEvaluation = useCreatePointCloudQualityEvaluation(projectId);
  const promoteEvaluation = usePromotePointCloudQualityEvaluation(projectId);

  useEffect(() => setCandidate(cloneConfig(config)), [config]);

  const latest =
    promoteEvaluation.data ?? createEvaluation.data ?? evaluationsQuery.data?.items[0] ?? null;
  const targets = useMemo(() => latest?.summary.changed_targets ?? [], [latest]);
  const selectedOverride =
    scope === "__global__" ? null : (candidate.class_thresholds[scope] ?? {});

  const thresholdValue = (key: keyof PointCloudQualityThresholdConfig): number =>
    selectedOverride?.[key] ?? candidate.thresholds[key];

  const updateThreshold = (key: keyof PointCloudQualityThresholdConfig, raw: string) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    setCandidate((current) => {
      const next = cloneConfig(current);
      if (scope === "__global__") {
        next.thresholds[key] = value;
      } else {
        next.class_thresholds[scope] = {
          ...(next.class_thresholds[scope] ?? {}),
          [key]: value,
        };
      }
      return next;
    });
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3" data-testid="quality-governance">
      <div className="rounded-md border border-border bg-background p-3">
        <div className="flex items-center gap-2 font-medium text-foreground">
          <FlaskConical className="size-4 text-brand" />
          候选阈值
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          只允许用既有问题安全重放的放宽方向。收紧阈值需要先运行新的质量扫描。
        </p>
        {canGovern ? (
          <>
            <label className="mt-3 block text-xs text-muted-foreground" htmlFor="quality-scope">
              应用范围
            </label>
            <select
              id="quality-scope"
              className="mt-1 h-8 w-full rounded-md border border-border bg-card px-2 text-xs text-foreground"
              value={scope}
              onChange={(event) => setScope(event.target.value)}
            >
              <option value="__global__">全局阈值</option>
              {classes.map((className) => (
                <option key={className} value={className}>
                  类别：{className}
                </option>
              ))}
            </select>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {THRESHOLD_FIELDS.map((field) => (
                <label key={field.key} className="text-xs text-muted-foreground">
                  {field.label}
                  <input
                    aria-label={field.label}
                    type="number"
                    min="0"
                    step={field.step}
                    value={thresholdValue(field.key)}
                    onChange={(event) => updateThreshold(field.key, event.target.value)}
                    className="mt-1 h-8 w-full rounded-md border border-border bg-card px-2 text-foreground"
                  />
                </label>
              ))}
            </div>
            <Button
              className="mt-3 w-full"
              size="sm"
              variant="primary"
              disabled={createEvaluation.isPending}
              onClick={() => createEvaluation.mutate(candidate)}
            >
              {createEvaluation.isPending ? "正在冻结样本…" : "生成候选评估"}
            </Button>
            {createEvaluation.isError && (
              <p className="mt-2 text-xs text-status-danger">
                评估失败。请检查候选是否为可重放的放宽方向，以及配置 revision 是否仍为最新。
              </p>
            )}
          </>
        ) : (
          <p className="mt-3 rounded-md bg-muted p-2 text-xs text-muted-foreground">
            你可以查看评估；只有项目负责人可创建和晋级候选。
          </p>
        )}
      </div>

      <div className="mt-3 rounded-md border border-border bg-background p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="font-medium text-foreground">最新冻结评估</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {latest
                ? `${latest.sample_count} 个已判定样本 · baseline r${latest.baseline_config_revision}`
                : "尚无评估"}
            </div>
          </div>
          {latest && (
            <span
              className={cn(
                "rounded-sm px-2 py-1 text-xs font-medium",
                latest.gate_status === "promote" && "bg-status-success-soft text-status-success",
                latest.gate_status === "hold" && "bg-status-danger-soft text-status-danger",
                latest.gate_status === "insufficient_data" &&
                  "bg-status-caution-soft text-status-caution",
              )}
            >
              {gateLabel(latest)}
            </span>
          )}
        </div>
        {evaluationsQuery.isLoading && (
          <p className="mt-3 text-xs text-muted-foreground">正在加载评估…</p>
        )}
        {latest && targets.length === 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            {REASON_LABEL[String(latest.gate_reasons[0]?.reason)] ?? "候选没有可晋级的阈值变更"}
          </p>
        )}
        <div className="mt-3 space-y-2">
          {targets.map((target) => (
            <div
              key={`${target.code}:${target.class_name ?? "all"}`}
              className="rounded-md border border-border p-2 text-xs"
            >
              <div className="flex items-center justify-between gap-2 font-medium text-foreground">
                <span>
                  {RULE_LABEL[target.code] ?? target.code}
                  {target.class_name ? ` · ${target.class_name}` : ""}
                </span>
                <span>
                  {target.status === "promote"
                    ? "通过"
                    : target.status === "hold"
                      ? "暂缓"
                      : "样本不足"}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1 text-muted-foreground">
                <span>可判定 {target.baseline.decidable_count}</span>
                <span>误报 {rate(target.candidate.observed_false_positive_rate)}</span>
                <span>保留 {rate(target.candidate.confirmed_retention)}</span>
              </div>
              {target.reasons.length > 0 && (
                <p className="mt-2 text-status-caution">
                  {target.reasons.map((reason) => REASON_LABEL[reason] ?? reason).join("；")}
                </p>
              )}
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          “保留”仅表示候选仍命中多少已确认问题，不是召回率；绝对召回率需要独立 Ground Truth。
        </p>
        {latest && canGovern && latest.gate_status === "promote" && !latest.promoted_at && (
          <Button
            className="mt-3 w-full"
            size="sm"
            variant="primary"
            disabled={promoteEvaluation.isPending}
            onClick={() => promoteEvaluation.mutate(latest.id)}
          >
            <ArrowUpRight className="size-3.5" />
            {promoteEvaluation.isPending ? "正在晋级…" : "晋级为项目配置"}
          </Button>
        )}
        {promoteEvaluation.isError && (
          <p className="mt-2 text-xs text-status-danger">
            晋级失败，baseline 可能已经变化；请基于最新配置重新评估。
          </p>
        )}
      </div>
    </div>
  );
}
