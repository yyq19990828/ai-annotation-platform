// 能力目录过滤工具栏(从 CapabilityCatalogPanel.tsx 拆出,行为零变化)。

import { Icon } from "@/components/ui/Icon";
import { infraLabel, modalityLabel, taskLabel } from "./labels";
import styles from "../CapabilityCatalogPanel.module.css";

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
    { label: "任务", values: p.facets.tasks, active: p.taskFilter, toggle: p.onToggleTask, render: taskLabel },
    { label: "模型族", values: p.facets.families, active: p.familyFilter, toggle: p.onToggleFamily, render: (v) => v },
    { label: "推理框架", values: p.facets.infras, active: p.infraFilter, toggle: p.onToggleInfra, render: infraLabel },
    { label: "模态", values: p.facets.modalities, active: p.modalityFilter, toggle: p.onToggleModality, render: modalityLabel },
  ];

  const anyFacet = groups.some((g) => g.values.length > 0);
  if (!anyFacet) return null;

  return (
    <div className={styles.toolbar}>
      {groups.map(
        (g) =>
          g.values.length > 0 && (
            <div key={g.label} className={styles.filterGroup}>
              <span className={styles.filterLabel}>{g.label}</span>
              <div className={styles.chipRow}>
                {g.values.map((v) => {
                  const on = g.active.has(v);
                  return (
                    <button
                      key={v}
                      type="button"
                      className={on ? `${styles.chip} ${styles.chipOn}` : styles.chip}
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
        <button type="button" className={styles.clearBtn} onClick={p.onClear}>
          <Icon name="x" size={11} />
          清除
        </button>
      )}
    </div>
  );
}
