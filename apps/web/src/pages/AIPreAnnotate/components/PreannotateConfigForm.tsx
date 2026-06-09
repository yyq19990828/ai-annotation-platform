/**
 * 预标"配置区"共享展示组件 (纯渲染, 状态由 usePreannotateConfig 提供)。
 *
 * 渲染: 任务类型 / 模型任务 / 类别白名单 / doc 提示 / prompt+alias / backend 多选 /
 * params+variant / 命名预设 / 输出形态。批量页与工作台 AI 面板共用。
 * 批量专属的 predict_mode / 并发 / run 按钮不在此, 由调用方拼。
 */
import { Icon } from "@/components/ui/Icon";
import { TabRow } from "@/components/ui/TabRow";
import { VariantSelector } from "@/components/ml/VariantSelector";
import { type TextOutputMode } from "@/hooks/usePreannotation";
import { SchemaForm } from "@/pages/Workbench/components/SchemaForm";
import { ClassWhitelistRow } from "./ClassWhitelistRow";
import { PresetRow } from "./PresetRow";
import { type PreannotateConfig, type PreannotateTaskType } from "./usePreannotateConfig";
import styles from "./ProjectDetailPanel.module.css";

const OUTPUT_MODE_TABS = ["□ 框", "○ 掩膜", "⊕ 全部"];
const OUTPUT_MODE_LABELS: Record<TextOutputMode, string> = {
  box: "□ 框",
  mask: "○ 掩膜",
  both: "⊕ 全部",
};
const OUTPUT_MODE_BY_LABEL: Record<string, TextOutputMode> = {
  "□ 框": "box",
  "○ 掩膜": "mask",
  "⊕ 全部": "both",
};

const TASK_TYPE_LABELS: Record<PreannotateTaskType, string> = {
  text: "文本预标",
  ocr: "OCR 文字识别",
  doc_layout: "文档版面",
};
const TASK_TYPE_BY_LABEL: Record<string, PreannotateTaskType> = {
  文本预标: "text",
  "OCR 文字识别": "ocr",
  文档版面: "doc_layout",
};

const GEOMETRIC_TASK_LABELS: Record<string, string> = {
  detection: "检测（框）",
  segmentation: "分割（掩膜）",
  keypoint: "关键点",
  obb: "朝向框",
};

function cx(...names: Array<string | false | null | undefined>) {
  return names.filter(Boolean).join(" ");
}

interface Props {
  cfg: PreannotateConfig;
  /** backend 多选 (批量页); 省略或 <=1 项时不渲染选择器 (工作台单 backend). */
  backends?: Array<{ id: string; name: string }>;
  selectedBackendId?: string | null;
  onSelectBackend?: (id: string | null) => void;
  projectMlBackendId?: string | null;
}

export function PreannotateConfigForm({
  cfg,
  backends,
  selectedBackendId,
  onSelectBackend,
  projectMlBackendId,
}: Props) {
  return (
    <>
      {/* v0.14.18 · 多 backend 选择 (批量页) — 置于面板最上方, 先选后端再配置其余字段. */}
      {backends && backends.length > 1 && onSelectBackend && (
        <label className={styles.field}>
          <span className={styles.fieldLabel}>ML Backend</span>
          <select
            value={selectedBackendId ?? ""}
            onChange={(e) => onSelectBackend(e.target.value || null)}
            className={styles.promptInput}
          >
            {backends.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.id === projectMlBackendId ? "（默认）" : ""}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* v0.14.9 · 任务类型选择 (backend 暴露 ocr / doc_layout 模型时). */}
      {cfg.hasDocTasks && (
        <div className={styles.field}>
          <span className={styles.fieldLabel}>任务类型</span>
          <TabRow
            tabs={cfg.availableTaskTypes.map((t) => TASK_TYPE_LABELS[t])}
            active={TASK_TYPE_LABELS[cfg.taskType]}
            onChange={(label) => {
              const t = TASK_TYPE_BY_LABEL[label];
              if (t) cfg.setTaskType(t);
            }}
          />
        </div>
      )}

      {/* v0.14.17 · 闭集多 task 几何 backend (YOLO): 显式选 task → 决定输出几何 + v2 结构化请求. */}
      {cfg.isGeometricBackend && cfg.geometricModels.length > 1 && (
        <div className={styles.field}>
          <span className={styles.fieldLabel}>模型任务</span>
          <TabRow
            tabs={cfg.geometricModels.map(
              (m) => GEOMETRIC_TASK_LABELS[m.task ?? ""] ?? m.task ?? m.id,
            )}
            active={
              cfg.geometricModel
                ? GEOMETRIC_TASK_LABELS[cfg.geometricModel.task ?? ""] ??
                  cfg.geometricModel.task ??
                  cfg.geometricModel.id
                : ""
            }
            onChange={(label) => {
              const m = cfg.geometricModels.find(
                (x) =>
                  (GEOMETRIC_TASK_LABELS[x.task ?? ""] ?? x.task ?? x.id) === label,
              );
              if (m) cfg.setGeometricTaskId(m.id);
            }}
          />
        </div>
      )}

      {/* v0.14.17 · YOLO 类别白名单勾选 ([index]类名). 留空=全部. */}
      {cfg.isGeometricBackend && (
        <ClassWhitelistRow
          classes={cfg.geometricModel?.classes}
          selected={cfg.selectedClassIdx}
          onChange={cfg.setSelectedClassIdx}
          onWarm={() => cfg.warmMut.mutate()}
          warming={cfg.warmMut.isPending}
        />
      )}

      {/* v0.14.9 · OCR / 版面识别静态提示. */}
      {cfg.isDocMode && (
        <div className={cx(styles.field, styles.docHint)}>
          <Icon name="info" size={12} />
          <span>
            {cfg.taskType === "ocr" ? "OCR 文字识别" : "文档版面"}
            ：识别文本将写入 annotation 属性；若项目未配置 text 属性，文本不会入库。
          </span>
        </div>
      )}

      {/* prompt 区: 开放词表文本任务 (gsam2) 显示; OCR/版面 与 YOLO 几何 backend 隐藏. */}
      {!cfg.isDocMode && !cfg.isGeometricBackend && (
        <label className={styles.field}>
          <span className={styles.fieldLabel}>
            Prompt（同一段文本应用到所有选中批次；逗号分隔）
          </span>
          {cfg.aliases.length > 0 && (
            <div className={styles.aliasList}>
              {cfg.aliases.map((a) => {
                const isActive = cfg.promptTokenSet.has(a.alias.toLowerCase());
                return (
                  <button
                    key={a.name}
                    type="button"
                    onClick={() => cfg.toggleAlias(a.alias)}
                    className={cx(styles.aliasChip, isActive && styles.aliasChipActive)}
                    title={`${isActive ? "移除" : "添加"} 类别「${a.name}」的 alias${a.count > 0 ? ` · 历史 ${a.count} 次` : ""}`}
                  >
                    <span>{isActive ? "✓ " : ""}{a.alias}</span>
                    <span className={styles.aliasName}>({a.name})</span>
                    {a.count > 0 && <span className={styles.aliasCount}>×{a.count}</span>}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => cfg.setPrompt(cfg.aliases.map((x) => x.alias).join(", "))}
                className={styles.refillButton}
                title="一键重填: 按频率拼上所有 alias"
              >
                重填
              </button>
            </div>
          )}
          <textarea
            rows={2}
            value={cfg.prompt}
            onChange={(e) => cfg.setPrompt(e.target.value)}
            placeholder="例：car, person, traffic light"
            className={styles.promptInput}
          />
        </label>
      )}

      {/* v0.10.38 · 按后端参数面板. */}
      <div className={styles.field}>
        <span className={styles.fieldLabel}>
          后端推理参数（按 backend 记忆，覆盖项目默认）
        </span>
        {!cfg.isDocMode && cfg.setupQ.isLoading ? (
          <div className={styles.mutedText}>加载参数…</div>
        ) : !cfg.isDocMode && cfg.setupQ.isError ? (
          <div className={styles.mutedText}>
            无法拉取 backend /setup，运行时回落项目级阈值。
          </div>
        ) : cfg.isDocMode && !cfg.hasAnyParams ? (
          <div className={styles.mutedText}>该任务无可调参数。</div>
        ) : (
          <div className={styles.backendParamsStack}>
            <VariantSelector
              schema={cfg.paramsSchema}
              supportedVariants={cfg.variantGroups}
              variantCombinations={cfg.variantCombinations}
              defaults={cfg.variantDefaults}
              value={cfg.paramsValue}
              onChange={cfg.onVariantOrParamsChange}
            />
            {(cfg.hasNonVariantParams || !cfg.hasAnyParams) && (
              <SchemaForm
                schema={cfg.paramsSchema}
                value={cfg.paramsValue}
                onChange={cfg.onParamsChange}
              />
            )}
          </div>
        )}
      </div>

      {/* v0.14.16 · 命名预设. */}
      <PresetRow
        presets={cfg.presets}
        disabled={!cfg.backendId}
        onApply={(p) => cfg.applyPreset(p.values)}
        onSave={(name) => cfg.savePreset(name, cfg.paramsValue)}
        onRemove={cfg.removePreset}
      />

      {/* v0.14.16 · 输出形态: 仅 model 同时支持框与掩膜时显示. */}
      {cfg.panelShape.showOutputMode && (
        <div className={styles.field}>
          <span className={styles.fieldLabel}>输出形态</span>
          <TabRow
            tabs={OUTPUT_MODE_TABS}
            active={OUTPUT_MODE_LABELS[cfg.outputMode]}
            onChange={(label) => {
              const m = OUTPUT_MODE_BY_LABEL[label];
              if (m) cfg.setOutputMode(m);
            }}
          />
        </div>
      )}
    </>
  );
}
