// v0.10.18 · CreateProjectWizard 第 1 步: 项目名 + 数据类型 + 工具集多选 + 截止日期.
// 从 CreateProjectWizard.tsx 抽出.

import { clsx } from "clsx";
import { Icon } from "@/components/ui/Icon";
import { PROJECT_TYPES } from "@/constants/projectTypes";
import {
  TOOL_UNIT_GROUPS,
  type ToolUnitId,
} from "@/constants/toolUnits";
import {
  defaultUnitBindings,
  type FormState,
} from "../CreateProjectWizard";
import styles from "../CreateProjectWizard.module.css";

export function Step1DataTypeAndTools({
  form,
  setForm,
  nameValid,
  dueValid,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  nameValid: boolean;
  dueValid: boolean;
}) {
  return (
    <div className={styles.formStackLarge}>
      <div>
        <label className={styles.label}>项目名称</label>
        <input
          value={form.name}
          onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
          placeholder="如:智能门店货架商品检测"
          maxLength={60}
          className={clsx(styles.input, !nameValid && styles.inputInvalid)}
        />
        {!nameValid && (
          <div className={styles.fieldError}>名称需 2-60 字符</div>
        )}
      </div>

      <div>
        <label className={styles.label}>数据类型</label>
        <div className={styles.typeGrid}>
          {PROJECT_TYPES.map((t) => {
            const active = t.key === form.typeKey;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() =>
                  setForm((s) => {
                    // v0.10.17 · 切类型时按新 data_type 重置默认 unitBindings,
                    // 但保留同一 unit 之前已配置的 classRows / attributeFields (避免误删).
                    const next = defaultUnitBindings(t.key);
                    for (const k of Object.keys(next) as ToolUnitId[]) {
                      const prev = s.unitBindings[k];
                      if (prev) next[k] = { ...next[k]!, ...prev };
                    }
                    const stillEnabled = (Object.keys(next) as ToolUnitId[]).find(
                      (k) => next[k]?.enabled,
                    );
                    return {
                      ...s,
                      typeKey: t.key,
                      unitBindings: next,
                      activeUnit: stillEnabled ?? "bbox",
                    };
                  })
                }
                className={clsx(
                  styles.typeButton,
                  active && styles.typeButtonActive,
                )}
              >
                <span
                  className={clsx(
                    styles.typeIcon,
                    active && styles.typeIconActive,
                  )}
                >
                  <Icon name={t.icon} size={14} />
                </span>
                <span className={styles.typeBody}>
                  <span className={styles.typeLabel}>{t.label}</span>
                  <span className={styles.typeHint}>{t.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* v0.10.17 · 工具集多选 chip. 三组: 矩形框 / 区域 / AI 交互 (region 与 AI 各自打包). */}
      <div>
        <label className={styles.label}>
          工具集{" "}
          <span className={styles.labelNote}>
            （勾选本项目要用的工具单位，每个单位有独立的类别与属性）
          </span>
        </label>
        <div className={styles.unitChipGrid}>
          {TOOL_UNIT_GROUPS.map((g) => {
            const binding = form.unitBindings[g.id];
            // 占位 unit 不显示 (polyline / lidar_box_3d 暂未实现, 但 region 等 data type 限制也要过滤)
            if (!binding) return null;
            const disabled = !g.available;
            return (
              <label
                key={g.id}
                className={clsx(
                  styles.unitChip,
                  binding.enabled && styles.unitChipActive,
                  disabled && styles.unitChipDisabled,
                )}
                title={disabled ? "本版未实现, 后续版本上线" : g.hint}
              >
                <input
                  type="checkbox"
                  checked={!!binding.enabled}
                  disabled={disabled}
                  onChange={(e) =>
                    setForm((s) => ({
                      ...s,
                      unitBindings: {
                        ...s.unitBindings,
                        [g.id]: {
                          enabled: e.target.checked,
                          classRows: s.unitBindings[g.id]?.classRows ?? [],
                          attributeFields:
                            s.unitBindings[g.id]?.attributeFields ?? [],
                        },
                      },
                    }))
                  }
                />
                <Icon name={g.icon} size={12} />
                <div className={styles.unitChipBody}>
                  <span className={styles.unitChipLabel}>{g.label}</span>
                  <span className={styles.unitChipHint}>{g.hint}</span>
                </div>
              </label>
            );
          })}
        </div>
      </div>

      <div>
        <label className={styles.label}>截止日期（可空）</label>
        <input
          type="date"
          value={form.dueDate}
          onChange={(e) => setForm((s) => ({ ...s, dueDate: e.target.value }))}
          className={clsx(styles.input, !dueValid && styles.inputInvalid)}
        />
        {!dueValid && (
          <div className={styles.fieldError}>截止日期不能早于今天</div>
        )}
      </div>
    </div>
  );
}
