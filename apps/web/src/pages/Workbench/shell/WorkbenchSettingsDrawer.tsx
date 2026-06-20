// v0.15.3 · 工作台设置抽屉:齿轮图标直接打开,按「通用 + 当前模态」分组渲染
// 字段注册表(workbenchSettingsFields.ts),改动经 useWorkbenchConfig.setFields 本地立即生效
// (画布实时预览)+ 300ms 防抖 PATCH。被项目 rendering_config 锁定的字段禁用 + badge。
import { useEffect, useReducer } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { Icon } from "@/components/ui/Icon";
import { Switch } from "@/components/ui/Switch";
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
  /** 孤儿标注过滤开关(局部 UI 状态,不持久化)。 */
  hideOrphanAnnotations?: boolean;
  onToggleHideOrphans?: () => void;
}

export function WorkbenchSettingsDrawer({
  open,
  onClose,
  stageKind,
  projectRenderingConfig,
  hideOrphanAnnotations,
  onToggleHideOrphans,
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
      <style>{`@keyframes slideInRight{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}`}</style>
      {/* 透明点击层:仅供点击关闭。刻意不加暗化遮罩 —— 抽屉的核心价值是所见即所得,
          调滤镜/平滑时画布必须保持原始观感。 */}
      <div onClick={onClose} className="fixed inset-0 z-drawer-backdrop bg-transparent" />
      <aside
        role="dialog"
        aria-label="工作台设置"
        aria-modal="false"
        onClick={(e) => e.stopPropagation()}
        className="fixed top-0 right-0 bottom-0 z-drawer flex flex-col w-[min(340px,100vw)] border-l border-border bg-card shadow-lg animate-[slideInRight_180ms_ease-out]"
        data-testid="workbench-settings-drawer"
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
          <div className="flex items-center gap-2 text-foreground">
            <Icon name="settings" size={14} />
            <span className="text-foreground text-sm font-semibold">工作台设置</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center p-1 appearance-none border-0 rounded-[var(--radius-sm)] bg-transparent text-muted-foreground cursor-pointer hover:text-foreground hover:bg-muted"
            aria-label="关闭"
          >
            <Icon name="x" size={14} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto flex flex-col gap-1.5 px-3.5 py-2.5">
          {!loaded && <div className="text-muted-foreground text-xs py-3.5 text-center">加载中…</div>}
          {loaded &&
            groups.map(({ category, fields }) => (
              <section key={category} className="flex flex-col">
                <h3 className="m-0 px-2.5 pt-2 pb-1.5 text-muted-foreground text-2xs font-semibold tracking-[0.06em] uppercase">
                  {WORKBENCH_SETTING_CATEGORY_LABELS[category]}
                </h3>
                <div className="flex flex-col gap-0.5">
                {fields.filter((field) => !field.parentKey).map((field) => {
                  const lockName = lockableFieldName(field);
                  const fieldValue = getFieldValue(config, field);
                  const childFields = fields.filter((child) => child.parentKey === field.key);
                  return (
                    <div key={field.key} className="flex flex-col gap-px">
                      <SettingsFieldControl
                        field={field}
                        value={fieldValue}
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
                      {childFields.map((child) => {
                        const childLockName = lockableFieldName(child);
                        return (
                          <SettingsFieldControl
                            key={child.key}
                            field={child}
                            value={getFieldValue(config, child)}
                            nested
                            disabled={!fieldValue}
                            locked={
                              childLockName !== null &&
                              lockedFields.includes(childLockName)
                            }
                            onCommit={(value) => {
                              if (isLocalSettingField(child)) {
                                child.write(value);
                                refreshLocalFields();
                                return;
                              }
                              setFields(buildFieldPatch(child, value));
                            }}
                          />
                        );
                      })}
                    </div>
                  );
                })}
                </div>
                {category === "common" && onToggleHideOrphans && (
                  <div className="flex items-center justify-between gap-3 box-border min-h-[38px] px-2.5 py-2 rounded-[var(--radius-sm)] transition-[background] duration-150 hover:bg-muted">
                    <span className="flex flex-1 min-w-0 flex-col gap-px">
                      <span className="text-muted-foreground text-xs font-medium">隐藏孤儿标注</span>
                      <span className="text-muted-foreground text-2xs">筛掉无匹配预测的人工框</span>
                    </span>
                    <Switch
                      checked={hideOrphanAnnotations ?? false}
                      onChange={onToggleHideOrphans}
                      data-testid="toggle-hide-orphans"
                    />
                  </div>
                )}
              </section>
            ))}
        </div>

        <footer className="px-4 py-2.5 border-t border-border bg-card">
          <Link to="/settings" className="inline-flex items-center gap-1 text-muted-foreground text-xs no-underline transition-[color] duration-150 hover:text-brand hover:underline" onClick={onClose}>
            全部设置（含其他模态）→ 个人设置页
          </Link>
        </footer>
      </aside>
    </>,
    document.body,
  );
}
