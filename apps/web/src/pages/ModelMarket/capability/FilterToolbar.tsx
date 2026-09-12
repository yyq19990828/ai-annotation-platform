import { useState } from "react";
import { FilterGroup, FilterToggle } from "@/components/filters/FilterControls";
import { FilterPanel } from "@/components/filters/FilterPanel";
import { FilterTrigger } from "@/components/filters/FilterTrigger";
import { ActiveFilterChip } from "@/components/filters/ActiveFilterChip";
import { Button } from "@/components/ui/Button";
// 能力目录过滤工具栏(从 CapabilityCatalogPanel.tsx 拆出,行为零变化)。

import { infraLabel, modalityLabel, taskLabel } from "./labels";

interface FilterToolbarProps {
  facets: { tasks: string[]; families: string[]; infras: string[]; modalities: string[] };
  taskFilter: Set<string>;
  familyFilter: Set<string>;
  infraFilter: Set<string>;
  modalityFilter: Set<string>;
  onToggleTask: (v: string) => void;
  onToggleFamily: (v: string) => void;
  onToggleInfra: (v: string) => void;
  onToggleModality: (v: string) => void;
  hasActiveFilter: boolean;
  onClear: () => void;
}

export function FilterToolbar(p: FilterToolbarProps) {
  const [open, setOpen] = useState(false);
  const groups: {
    label: string;
    values: string[];
    active: Set<string>;
    toggle: (v: string) => void;
    render: (v: string) => string;
  }[] = [
    {
      label: "任务",
      values: p.facets.tasks,
      active: p.taskFilter,
      toggle: p.onToggleTask,
      render: taskLabel,
    },
    {
      label: "模型族",
      values: p.facets.families,
      active: p.familyFilter,
      toggle: p.onToggleFamily,
      render: (v) => v,
    },
    {
      label: "推理框架",
      values: p.facets.infras,
      active: p.infraFilter,
      toggle: p.onToggleInfra,
      render: infraLabel,
    },
    {
      label: "模态",
      values: p.facets.modalities,
      active: p.modalityFilter,
      toggle: p.onToggleModality,
      render: modalityLabel,
    },
  ];

  const anyFacet = groups.some((group) => group.values.length > 0);
  if (!anyFacet) return null;
  const renderGroup = (group: (typeof groups)[number]) => (
    <div key={group.label} className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="shrink-0 text-xs font-medium text-muted-foreground">{group.label}</span>
      <div className="flex flex-wrap gap-1">
        {group.values.map((value) => (
          <FilterToggle
            key={value}
            active={group.active.has(value)}
            onClick={() => group.toggle(value)}
          >
            {group.render(value)}
          </FilterToggle>
        ))}
      </div>
    </div>
  );
  return (
    <div className="space-y-2 border-b border-border px-4 py-3">
      <FilterGroup label="筛选">
        {groups
          .filter((group) => group.label === "任务" || group.label === "模态")
          .filter((group) => group.values.length > 0)
          .map(renderGroup)}
        <FilterPanel
          open={open}
          onOpenChange={setOpen}
          trigger={
            <FilterTrigger count={Number(p.familyFilter.size > 0) + Number(p.infraFilter.size > 0)}>
              更多筛选
            </FilterTrigger>
          }
          title="模型筛选"
          description="即时生效 · 按模型族和推理框架进一步筛选。"
          align="start"
          footer={
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setOpen(false)}>
                完成
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            {groups
              .filter((group) => group.label === "模型族" || group.label === "推理框架")
              .filter((group) => group.values.length > 0)
              .map(renderGroup)}
          </div>
        </FilterPanel>
        {p.hasActiveFilter && (
          <Button size="sm" variant="ghost" onClick={p.onClear}>
            清除条件
          </Button>
        )}
      </FilterGroup>
      {(p.familyFilter.size > 0 || p.infraFilter.size > 0) && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="已应用的模型筛选">
          {groups
            .filter((group) => group.label === "模型族" || group.label === "推理框架")
            .flatMap((group) =>
              [...group.active].map((value) => (
                <ActiveFilterChip
                  key={`${group.label}:${value}`}
                  label={group.label}
                  value={group.render(value)}
                  onClick={() => setOpen(true)}
                  onRemove={() => group.toggle(value)}
                />
              )),
            )}
        </div>
      )}
    </div>
  );
}
