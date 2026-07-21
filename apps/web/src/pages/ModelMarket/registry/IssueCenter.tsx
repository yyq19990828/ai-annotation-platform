/**
 * v0.23.4 P3 · registry "问题中心" tab (Super Admin only).
 *
 * Plan §7 + Appendix A.3: same `code + subject_type + subject_id` renders only
 * ONE primary record in the issue center; affected objects are listed in the
 * `affected_*_ids[]` arrays. The orchestrator already ran `collectDiagnostics`
 * (deduped) and the diagnostics list is shared with all section rows — so this
 * component just sorts (`sortDiagnostics`) and filters (`filterDiagnostics`).
 *
 * Filter bar: by pool / instance / GPU / code. Each diagnostic shows the
 * severity badge + full message + remediation + affected-object count with
 * stable IDs listed inline.
 */
import { useMemo, useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/shadcn/ui/input";

import { EmptyState } from "./registryUi";
import type { RegistryScope } from "./registryTypes";
import type { Diagnostic, DiagnosticFilter, Severity } from "../runtimeTopology";
import { filterDiagnostics, sortDiagnostics } from "../runtimeTopology";
import { SEVERITY_TOKENS } from "../runtime/StateTokens";

export function IssueCenter({ scope }: { scope: RegistryScope }): ReactNode {
  const { diagnostics, vm } = scope;
  const [filter, setFilter] = useState<DiagnosticFilter>({});
  const [codeQuery, setCodeQuery] = useState("");

  const sorted = useMemo(() => sortDiagnostics(diagnostics), [diagnostics]);
  const filtered = useMemo(() => {
    const withCode = codeQuery.trim()
      ? sorted.filter((d) => d.code.toLowerCase().includes(codeQuery.trim().toLowerCase()))
      : sorted;
    return filterDiagnostics(withCode, filter);
  }, [sorted, filter, codeQuery]);

  // Distinct codes + subjects for filter dropdowns.
  const codes = useMemo(() => Array.from(new Set(sorted.map((d) => d.code))).sort(), [sorted]);
  const poolIds = useMemo(
    () => Array.from(new Set(sorted.flatMap((d) => d.affected_service_pool_ids))).sort(),
    [sorted],
  );
  const instanceIds = useMemo(
    () => Array.from(new Set(sorted.flatMap((d) => d.affected_instance_ids))).sort(),
    [sorted],
  );
  const gpuIds = useMemo(
    () => Array.from(new Set(sorted.flatMap((d) => d.affected_gpu_resource_ids))).sort(),
    [sorted],
  );

  const counts = useMemo(() => {
    const by: Record<Diagnostic["severity"], number> = {
      blocker: 0,
      critical: 0,
      warning: 0,
      info: 0,
    };
    for (const d of sorted) by[d.severity] += 1;
    return by;
  }, [sorted]);

  return (
    <div className="flex flex-col gap-3">
      {/* Severity summary */}
      <div className="flex flex-wrap items-center gap-2">
        <SummaryBadge label="阻断" count={counts.blocker} variant="danger" />
        <SummaryBadge label="严重" count={counts.critical} variant="danger" />
        <SummaryBadge label="告警" count={counts.warning} variant="warning" />
        <SummaryBadge label="提示" count={counts.info} variant="accent" />
        <span className="text-2xs text-muted-foreground">
          共 {sorted.length} 条（已按 code+subject 去重）
        </span>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="按 code 搜索"
          placeholder="按 code 搜索（如 circuit_open）"
          value={codeQuery}
          onChange={(e) => setCodeQuery(e.target.value)}
          className="h-8 w-56 text-xs"
        />
        <FilterSelect
          label="服务池"
          value={filter.pool_id ?? ""}
          options={poolIds}
          onChange={(v) => setFilter((f) => ({ ...f, pool_id: v || undefined }))}
        />
        <FilterSelect
          label="实例"
          value={filter.instance_id ?? ""}
          options={instanceIds}
          onChange={(v) => setFilter((f) => ({ ...f, instance_id: v || undefined }))}
        />
        <FilterSelect
          label="GPU"
          value={filter.gpu_resource_id ?? ""}
          options={gpuIds}
          onChange={(v) => setFilter((f) => ({ ...f, gpu_resource_id: v || undefined }))}
        />
        <FilterSelect
          label="code"
          value={filter.code ?? ""}
          options={codes}
          onChange={(v) => setFilter((f) => ({ ...f, code: v || undefined }))}
        />
        {(filter.pool_id ||
          filter.instance_id ||
          filter.gpu_resource_id ||
          filter.code ||
          codeQuery) && (
          <button
            type="button"
            onClick={() => {
              setFilter({});
              setCodeQuery("");
            }}
            className="text-2xs text-brand no-underline hover:underline"
          >
            清除筛选
          </button>
        )}
      </div>

      {/* Diagnostic list */}
      {filtered.length === 0 ? (
        <EmptyState
          icon="checkCircle"
          message={sorted.length === 0 ? "当前没有诊断告警" : "没有匹配的诊断"}
          hint={
            sorted.length === 0
              ? "服务池、实例、GPU 资源的状态均无 critical / blocker 级问题。"
              : undefined
          }
        />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {filtered.map((d) => (
            <DiagnosticRow key={d.id} diagnostic={d} scope={scope} />
          ))}
        </ul>
      )}
    </div>
  );
}

function DiagnosticRow({
  diagnostic,
  scope,
}: {
  diagnostic: Diagnostic;
  scope: RegistryScope;
}): ReactNode {
  const subjectLabel = subjectLabelOf(diagnostic, scope);
  const sevToken = SEVERITY_TOKENS[diagnostic.severity];
  return (
    <li className="flex flex-col gap-1.5 rounded-md border border-border bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {/* Severity badge: icon + label only. The full message is rendered
            in the body below — we must NOT duplicate it here (plan §7.1:
            one primary record per code+subject). */}
        <Badge variant={sevToken.variant}>
          <Icon name={sevToken.icon} size={11} />
          <span>{sevToken.label}</span>
        </Badge>
        <Badge variant="outline" className="text-2xs">
          {diagnostic.code}
        </Badge>
        <span className="text-2xs text-muted-foreground">{diagnostic.source}</span>
      </div>
      <div className="text-sm">{diagnostic.message}</div>
      {diagnostic.remediation && (
        <div className="flex items-start gap-1.5 text-2xs text-muted-foreground">
          <Icon name="info" size={11} className="mt-0.5 flex-shrink-0" />
          <span>建议 · {diagnostic.remediation}</span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
        <span>对象 · {subjectLabel}</span>
        {diagnostic.affected_service_pool_ids.length > 0 && (
          <span>服务池 {diagnostic.affected_service_pool_ids.length}</span>
        )}
        {diagnostic.affected_instance_ids.length > 0 && (
          <span>实例 {diagnostic.affected_instance_ids.length}</span>
        )}
        {diagnostic.affected_gpu_resource_ids.length > 0 && (
          <span>GPU {diagnostic.affected_gpu_resource_ids.length}</span>
        )}
      </div>
    </li>
  );
}

function subjectLabelOf(d: Diagnostic, scope: RegistryScope): string {
  switch (d.subject_type) {
    case "service_pool": {
      const pool = scope.vm.pools.find((p) => p.id === d.subject_id);
      return pool ? `服务池「${pool.name}」` : `服务池 ${d.subject_id}`;
    }
    case "instance": {
      for (const pool of scope.vm.pools) {
        const m = pool.members.find((x) => x.registry_id === d.subject_id);
        if (m) return `实例「${m.name}」`;
      }
      return `实例 ${d.subject_id}`;
    }
    case "gpu_resource":
      return `GPU ${d.subject_id}`;
    case "model_pool":
      return `模型池 ${d.subject_id}`;
    default:
      return d.subject_id;
  }
}

function SummaryBadge({
  label,
  count,
  variant,
}: {
  label: string;
  count: number;
  variant: "danger" | "warning" | "accent" | "outline";
}): ReactNode {
  return (
    <Badge variant={variant}>
      <span>{label}</span>
      <span className="font-semibold">{count}</span>
    </Badge>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}): ReactNode {
  return (
    <label className="inline-flex items-center gap-1 text-2xs text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 rounded-md border border-border bg-card px-2 text-xs text-foreground outline-none [font-family:inherit]"
        aria-label={`按 ${label} 筛选`}
      >
        <option value="">全部</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
