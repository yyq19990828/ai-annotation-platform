// v0.10.17 · 工具单位 Tab. enabled=false 的 unit 仍能切到 (展示空状态), 在 Step1
// 的工具集 chips 区切换. 不可用 (本版无实现的 polyline / lidar_box_3d) 不显示.
// v0.10.18 · 从 CreateProjectWizard.tsx 抽出.

import { clsx } from "clsx";
import { Icon } from "@/components/ui/Icon";
import { TOOL_UNIT_GROUPS } from "@/constants/toolUnits";
import type { FormState } from "../CreateProjectWizard";
import styles from "../CreateProjectWizard.module.css";

export function UnitTabs({
  form,
  setForm,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
}) {
  const visible = TOOL_UNIT_GROUPS.filter(
    (g) => g.available && form.unitBindings[g.id],
  );
  return (
    <div className={styles.unitTabs}>
      {visible.map((g) => {
        const ub = form.unitBindings[g.id];
        const active = form.activeUnit === g.id;
        return (
          <button
            key={g.id}
            type="button"
            onClick={() => setForm((s) => ({ ...s, activeUnit: g.id }))}
            className={clsx(
              styles.unitTab,
              active && styles.unitTabActive,
              !ub?.enabled && styles.unitTabDisabled,
            )}
            title={
              ub?.enabled ? undefined : "未启用此工具集 (回到第 1 步可勾选)"
            }
          >
            <Icon name={g.icon} size={12} />
            <span>{g.label}</span>
            {!ub?.enabled && <span className={styles.unitTabBadge}>未启用</span>}
          </button>
        );
      })}
    </div>
  );
}
