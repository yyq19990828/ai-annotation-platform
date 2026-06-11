// v0.15.3 · 工作台设置抽屉:齿轮菜单「工作台设置」入口打开,按「通用 + 当前模态」两组渲染
// 字段注册表(workbenchSettingsFields.ts),改动经 useWorkbenchConfig.setFields 本地立即生效
// (画布实时预览)+ 300ms 防抖 PATCH。被项目 rendering_config 锁定的字段禁用 + badge。
import { useEffect, useReducer } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { Icon } from "@/components/ui/Icon";
import type { ProjectRenderingConfig } from "@/api/projects";
import { SettingsFieldControl } from "../components/SettingsFieldControl";
import type { StageKind } from "../stages/types";
import {
  WORKBENCH_SETTING_CATEGORY_LABELS,
  WORKBENCH_SETTING_FIELDS,
  buildFieldPatch,
  getFieldValue,
  isLocalSettingField,
  lockableFieldName,
  type WorkbenchSettingCategory,
} from "../state/workbenchSettingsFields";
import { useWorkbenchConfig } from "../state/useWorkbenchConfig";
import styles from "./WorkbenchSettingsDrawer.module.css";

/** stageKind → 注册表模态分类("3d" 对应 pointcloud 子树)。 */
const STAGE_CATEGORY: Record<StageKind, WorkbenchSettingCategory> = {
  image: "image",
  video: "video",
  "3d": "pointcloud",
};

interface WorkbenchSettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  stageKind: StageKind;
  /** 项目级渲染覆盖;锁定字段在抽屉中禁用(与画布合并结果一致)。 */
  projectRenderingConfig?: ProjectRenderingConfig | null;
}

export function WorkbenchSettingsDrawer({
  open,
  onClose,
  stageKind,
  projectRenderingConfig,
}: WorkbenchSettingsDrawerProps) {
  // 独立 hook 实例:setFields 改动经模块级广播同步到画布侧实例 → 实时预览。
  const { config, loaded, lockedFields, setFields } = useWorkbenchConfig(
    projectRenderingConfig,
  );
  const [, refreshLocalFields] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const categories: WorkbenchSettingCategory[] =
    stageKind === "video"
      ? ["common", "video", "experiment"]
      : ["common", STAGE_CATEGORY[stageKind]];
  const groups = categories
    .map((category) => ({
      category,
      fields: WORKBENCH_SETTING_FIELDS.filter(
        (f) => f.category === category && !f.hidden,
      ),
    }))
    .filter((g) => g.fields.length > 0);

  return createPortal(
    <>
      {/* 透明点击层:仅供点击关闭。刻意不加暗化遮罩 —— 抽屉的核心价值是所见即所得,
          调滤镜/平滑时画布必须保持原始观感。 */}
      <div onClick={onClose} className={styles.backdrop} />
      <aside
        role="dialog"
        aria-label="工作台设置"
        aria-modal="false"
        onClick={(e) => e.stopPropagation()}
        className={styles.drawer}
        data-testid="workbench-settings-drawer"
      >
        <header className={styles.header}>
          <div className={styles.headerContent}>
            <Icon name="settings" size={14} />
            <span className={styles.title}>工作台设置</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={styles.iconButton}
            aria-label="关闭"
          >
            <Icon name="x" size={14} />
          </button>
        </header>

        <div className={styles.body}>
          {!loaded && <div className={styles.loading}>加载中…</div>}
          {loaded &&
            groups.map(({ category, fields }) => (
              <section key={category} className={styles.group}>
                <h3 className={styles.groupTitle}>
                  {WORKBENCH_SETTING_CATEGORY_LABELS[category]}
                </h3>
                {fields.map((field) => {
                  const lockName = lockableFieldName(field);
                  return (
                    <SettingsFieldControl
                      key={field.key}
                      field={field}
                      value={getFieldValue(config, field)}
                      locked={lockName !== null && lockedFields.includes(lockName)}
                      onCommit={(value) => {
                        if (isLocalSettingField(field)) {
                          field.write(value);
                          refreshLocalFields();
                          return;
                        }
                        setFields(buildFieldPatch(field, value));
                      }}
                    />
                  );
                })}
              </section>
            ))}
        </div>

        <footer className={styles.footer}>
          <Link to="/settings" className={styles.settingsLink} onClick={onClose}>
            全部设置（含其他模态）→ 个人设置页
          </Link>
        </footer>
      </aside>
    </>,
    document.body,
  );
}
