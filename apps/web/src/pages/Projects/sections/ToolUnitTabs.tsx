/**
 * v0.10.17 · ProjectSettings ClassesSection / TemplateEditModal
 *  共享的 unit tab 切换条 + enabled chip 控件.
 */

import { Icon } from "@/components/ui/Icon";
import { clsx } from "clsx";
import {
  TOOL_UNIT_GROUPS,
  type ProjectDataType,
  type ToolUnitId,
} from "@/constants/toolUnits";
import type { UnitBindingMap } from "./useProjectToolBindings";
import styles from "./ToolUnitTabs.module.css";

interface Props {
  bindings: UnitBindingMap;
  activeUnit: ToolUnitId;
  onSelect: (unit: ToolUnitId) => void;
  dataType?: ProjectDataType;
  /** 是否允许在此处切换 enabled 状态. Section 内默认 false (不让用户在类别页删 unit). */
  allowToggle?: boolean;
  onToggle?: (unit: ToolUnitId, enabled: boolean) => void;
}

export function ToolUnitTabs({
  bindings,
  activeUnit,
  onSelect,
  dataType,
  allowToggle = false,
  onToggle,
}: Props) {
  const visible = TOOL_UNIT_GROUPS.filter(
    (g) => g.available && bindings[g.id] !== undefined,
  );
  return (
    <div className={styles.tabs}>
      {visible.map((g) => {
        const ub = bindings[g.id];
        const active = activeUnit === g.id;
        const enabled = !!ub?.enabled;
        const label = toolUnitLabel(g.id, g.label, dataType);
        return (
          <div
            key={g.id}
            className={clsx(
              styles.tab,
              active && styles.tabActive,
              !enabled && styles.tabDisabled,
            )}
          >
            {allowToggle && onToggle && (
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => onToggle(g.id, e.target.checked)}
                className={styles.toggle}
                title={enabled ? "点击禁用此工具单位" : "点击启用此工具单位"}
              />
            )}
            <button
              type="button"
              onClick={() => onSelect(g.id)}
              className={styles.tabButton}
            >
              <Icon name={g.icon} size={12} />
              <span>{label}</span>
              {ub && ub.classRows.length > 0 && (
                <span className={styles.badge}>{ub.classRows.length}</span>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function toolUnitLabel(
  unit: ToolUnitId,
  fallback: string,
  dataType?: ProjectDataType,
): string {
  if (dataType === "video" && unit === "bbox") {
    return "矩形框 / 轨迹";
  }
  return fallback;
}
