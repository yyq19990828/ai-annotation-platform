// 能力目录过滤工具栏(从 CapabilityCatalogPanel.tsx 拆出,行为零变化)。

import { Icon } from "@/components/ui/Icon";
import { infraLabel, modalityLabel, taskLabel } from "./labels";

const CHIP_BASE =
  "cursor-pointer appearance-none rounded-full border px-2.5 py-1 text-xs leading-[1.4]";
const CHIP_OFF = `${CHIP_BASE} border-border bg-muted text-muted-foreground hover:bg-muted`;
const CHIP_ON = `${CHIP_BASE} border-brand/30 bg-brand/10 text-brand`;

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

  const anyFacet = groups.some((g) => g.values.length > 0);
  if (!anyFacet) return null;

  return (
    <div className="flex flex-wrap items-center gap-3.5 border-b border-border px-4 py-3">
      {groups.map(
        (g) =>
          g.values.length > 0 && (
            <div key={g.label} className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 text-2xs font-semibold text-muted-foreground">
                {g.label}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {g.values.map((v) => {
                  const on = g.active.has(v);
                  return (
                    <button
                      key={v}
                      type="button"
                      className={on ? CHIP_ON : CHIP_OFF}
                      onClick={() => g.toggle(v)}
                      aria-pressed={on}
                    >
                      {g.render(v)}
                    </button>
                  );
                })}
              </div>
            </div>
          ),
      )}
      {p.hasActiveFilter && (
        <button
          type="button"
          className="ml-auto inline-flex cursor-pointer appearance-none items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"
          onClick={p.onClear}
        >
          <Icon name="x" size={11} />
          清除
        </button>
      )}
    </div>
  );
}
