import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Card } from "@/components/ui/Card";
import { useToastStore } from "@/components/ui/Toast";
import { useUpdateProject } from "@/hooks/useProjects";
import { useUnsavedWarning } from "@/hooks/useUnsavedWarning";
import { useMLBackends } from "@/hooks/useMLBackends";
import { PRESET_AI_MODELS, CUSTOM_MODEL_KEY } from "@/constants/projectTypes";
import {
  TextOutputDefaultSelect,
  type TextOutputDefault,
} from "@/components/projects/shared/TextOutputDefaultSelect";
import type { ProjectResponse } from "@/api/projects";
import styles from "./GeneralSection.module.css";

const STATUS_OPTIONS = [
  { value: "in_progress", label: "进行中" },
  { value: "pending_review", label: "待审核" },
  { value: "completed", label: "已完成" },
  { value: "archived", label: "已归档" },
];

function cn(...xs: Array<string | false | null | undefined>): string {
  return xs.filter(Boolean).join(" ");
}

export function GeneralSection({ project }: { project: ProjectResponse }) {
  const pushToast = useToastStore((s) => s.push);
  const update = useUpdateProject(project.id);

  const initialAiChoice =
    project.ai_model && PRESET_AI_MODELS.includes(project.ai_model)
      ? project.ai_model
      : project.ai_model
        ? CUSTOM_MODEL_KEY
        : PRESET_AI_MODELS[0];

  const [name, setName] = useState(project.name);
  const [status, setStatus] = useState(project.status);
  const [dueDate, setDueDate] = useState(project.due_date ?? "");
  const [classes, setClasses] = useState<string[]>(project.classes ?? []);
  const [classInput, setClassInput] = useState("");
  const [aiEnabled, setAiEnabled] = useState(project.ai_enabled);
  const [aiChoice, setAiChoice] = useState(initialAiChoice);
  const [aiCustom, setAiCustom] = useState(
    project.ai_model && !PRESET_AI_MODELS.includes(project.ai_model) ? project.ai_model : "",
  );
  // v0.8.6 F3 · MLBackend 真实绑定
  const [mlBackendId, setMlBackendId] = useState<string | null>(
    project.ml_backend_id ?? null,
  );
  const { data: mlBackends = [] } = useMLBackends(project.id);
  const [iouThreshold, setIouThreshold] = useState(project.iou_dedup_threshold ?? 0.7);
  // v0.9.2 · GroundingDINO 阈值（仅 SAM 文本 prompt 路径生效；point/bbox 不参与）
  const [boxThreshold, setBoxThreshold] = useState(project.box_threshold ?? 0.35);
  const [textThreshold, setTextThreshold] = useState(project.text_threshold ?? 0.25);
  // v0.9.5 · SAM 文本预标默认输出形态（"" = 自动按 type_key）
  const [textOutputDefault, setTextOutputDefault] = useState<string>(
    project.text_output_default ?? "",
  );

  useEffect(() => {
    setName(project.name);
    setStatus(project.status);
    setDueDate(project.due_date ?? "");
    setClasses(project.classes ?? []);
    setAiEnabled(project.ai_enabled);
    setAiChoice(initialAiChoice);
    setAiCustom(project.ai_model && !PRESET_AI_MODELS.includes(project.ai_model) ? project.ai_model : "");
    setMlBackendId(project.ml_backend_id ?? null);
    setIouThreshold(project.iou_dedup_threshold ?? 0.7);
    setBoxThreshold(project.box_threshold ?? 0.35);
    setTextThreshold(project.text_threshold ?? 0.25);
    setTextOutputDefault(project.text_output_default ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const addClass = () => {
    const v = classInput.trim();
    if (!v || v.length > 30 || classes.includes(v)) {
      setClassInput("");
      return;
    }
    setClasses((s) => [...s, v]);
    setClassInput("");
  };

  const resolvedAiModel = aiChoice === CUSTOM_MODEL_KEY ? aiCustom.trim() : aiChoice;
  const dirty =
    name.trim() !== project.name ||
    status !== project.status ||
    (dueDate || null) !== (project.due_date ?? null) ||
    JSON.stringify(classes) !== JSON.stringify(project.classes ?? []) ||
    aiEnabled !== project.ai_enabled ||
    (aiEnabled ? resolvedAiModel : null) !== (project.ai_model ?? null) ||
    (mlBackendId ?? null) !== (project.ml_backend_id ?? null) ||
    Math.abs(iouThreshold - (project.iou_dedup_threshold ?? 0.7)) > 0.001 ||
    Math.abs(boxThreshold - (project.box_threshold ?? 0.35)) > 0.001 ||
    Math.abs(textThreshold - (project.text_threshold ?? 0.25)) > 0.001 ||
    textOutputDefault !== (project.text_output_default ?? "");

  useUnsavedWarning(dirty);

  const onSave = () => {
    if (!name.trim()) {
      pushToast({ msg: "项目名称不能为空" });
      return;
    }
    // B-7 · 模型名优先取已绑定 backend.name,fallback 到手动 hint
    const boundBackendName =
      mlBackendId && mlBackends.find((b) => b.id === mlBackendId)?.name;
    const effectiveAiModel = boundBackendName || resolvedAiModel;
    if (aiEnabled && !effectiveAiModel) {
      pushToast({ msg: "启用 AI 时需绑定 ML Backend 或在高级中指定模型名" });
      return;
    }
    update.mutate(
      {
        name: name.trim(),
        status,
        due_date: dueDate || null,
        classes,
        ai_enabled: aiEnabled,
        ai_model: aiEnabled ? effectiveAiModel : null,
        ml_backend_id: aiEnabled ? mlBackendId : null,
        iou_dedup_threshold: iouThreshold,
        box_threshold: boxThreshold,
        text_threshold: textThreshold,
        text_output_default: (textOutputDefault || null) as "box" | "mask" | "both" | null,
      },
      {
        onSuccess: () => pushToast({ msg: "项目已更新", kind: "success" }),
        onError: (err) =>
          pushToast({ msg: "保存失败", sub: (err as Error).message }),
      },
    );
  };

  return (
    <Card>
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>基本信息</h3>
      </div>
      <div className={styles.body}>
        <div>
          <label className={styles.label}>项目名称</label>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={styles.control} />
        </div>
        <div className={styles.gridTwo}>
          <div>
            <label className={styles.label}>状态</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={cn(styles.control, styles.selectControl)}>
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={styles.label}>截止日期</label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={styles.control} />
          </div>
        </div>
        <div>
          <label className={styles.label}>类型</label>
          <div className={styles.readonlyValue}>
            {project.type_label} <span className={cn("mono", styles.typeKey)}>{project.type_key}</span>
          </div>
        </div>
        <div>
          <label className={styles.label}>标注类别</label>
          <div className={styles.classInputRow}>
            <input
              value={classInput}
              onChange={(e) => setClassInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addClass();
                }
              }}
              placeholder="回车添加"
              maxLength={30}
              className={cn(styles.control, styles.classInput)}
            />
            <Button onClick={addClass} disabled={!classInput.trim()}>
              <Icon name="plus" size={12} />添加
            </Button>
          </div>
          <div className={styles.classChipBox}>
            {classes.length === 0 && (
              <span className={styles.emptyText}>暂无类别</span>
            )}
            {classes.map((c) => (
              <span
                key={c}
                className={styles.classChip}
              >
                {c}
                <button
                  type="button"
                  onClick={() => setClasses((s) => s.filter((x) => x !== c))}
                  aria-label={`删除 ${c}`}
                  className={styles.classChipRemove}
                >
                  <Icon name="x" size={10} />
                </button>
              </span>
            ))}
          </div>
        </div>
        <div>
          <label className={styles.aiToggleLabel}>
            <input
              type="checkbox"
              checked={aiEnabled}
              onChange={(e) => setAiEnabled(e.target.checked)}
              className={styles.aiCheckbox}
            />
            <Icon name="sparkles" size={14} className={styles.aiIcon} />
            启用 AI 预标注
          </label>
          {aiEnabled && (
            <div className={styles.aiPanel}>
              {/* B-7 · 实际 ML Backend 绑定 — 模型语义直接来自注册的 backend.name,
                  不再用脱离实际部署的 PRESET 占位字符串 */}
              <div>
                <label className={cn(styles.label, styles.labelCompact)}>实际 ML Backend</label>
                <select
                  value={mlBackendId ?? ""}
                  onChange={(e) => setMlBackendId(e.target.value || null)}
                  className={cn(styles.control, styles.selectControl)}
                >
                  <option value="">未绑定（项目按肉眼标注运行,AI 待接入）</option>
                  {mlBackends.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                      {b.state === "connected" ? " · 在线" : ` · ${b.state}`}
                      {b.is_interactive ? " · 交互式" : ""}
                    </option>
                  ))}
                </select>
                <div className={styles.hint}>
                  绑定后,平台所有「模型名」展示均直接来自 backend.name,保证 UI 语义与实际推理后端一致。
                  {mlBackends.length === 0 && (
                    <span className={styles.warningText}>
                      暂无可用 backend;先在「ML 模型」选项卡添加。
                    </span>
                  )}
                </div>
              </div>

              {/* B-7 · 折叠 PRESET 占位入口为 advanced — 仅历史项目或离线场景需要手填模型名 */}
              <details className={styles.advancedDetails}>
                <summary className={styles.advancedSummary}>
                  高级:手动指定模型名 hint（仅当未绑定 backend 时生效）
                </summary>
                <div className={styles.advancedBody}>
                  <select
                    value={aiChoice}
                    onChange={(e) => setAiChoice(e.target.value)}
                    className={cn(styles.control, styles.selectControl)}
                  >
                    {PRESET_AI_MODELS.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                    <option value={CUSTOM_MODEL_KEY}>自定义...</option>
                  </select>
                  {aiChoice === CUSTOM_MODEL_KEY && (
                    <input
                      value={aiCustom}
                      onChange={(e) => setAiCustom(e.target.value)}
                      placeholder="自定义模型名称"
                      maxLength={120}
                      className={styles.control}
                    />
                  )}
                </div>
              </details>
            </div>
          )}
        </div>
        <div>
          <label className={styles.label}>
            AI 框去重阈值 <span className={styles.labelNote}>（与已确认人工框 IoU 高于此值的同类 AI 框将淡化）</span>
          </label>
          <div className={styles.sliderRow}>
            <input
              type="range"
              min={0.3}
              max={0.95}
              step={0.05}
              value={iouThreshold}
              onChange={(e) => setIouThreshold(Number(e.target.value))}
              className={styles.rangeInput}
            />
            <span
              className={cn("mono", styles.metricValue)}
            >
              {iouThreshold.toFixed(2)}
            </span>
          </div>
        </div>
        <div>
          <label className={styles.label}>
            DINO box 阈值 <span className={styles.labelNote}>（SAM 文本 prompt 时使用；车牌/商品等小物可降；噪声多可升）</span>
          </label>
          <div className={styles.sliderRow}>
            <input
              type="range" min={0} max={1} step={0.05}
              value={boxThreshold}
              onChange={(e) => setBoxThreshold(Number(e.target.value))}
              className={styles.rangeInput}
            />
            <span className={cn("mono", styles.metricValue)}>
              {boxThreshold.toFixed(2)}
            </span>
          </div>
        </div>
        <div>
          <label className={styles.label}>
            DINO text 阈值 <span className={styles.labelNote}>（短语—区域匹配的语义最低分；越高越严格）</span>
          </label>
          <div className={styles.sliderRow}>
            <input
              type="range" min={0} max={1} step={0.05}
              value={textThreshold}
              onChange={(e) => setTextThreshold(Number(e.target.value))}
              className={styles.rangeInput}
            />
            <span className={cn("mono", styles.metricValue)}>
              {textThreshold.toFixed(2)}
            </span>
          </div>
        </div>
        <div>
          <label className={styles.label}>
            SAM 文本预标默认输出 <span className={styles.labelNote}>（工作台「找全图」初始值，可在工作台临时切换）</span>
          </label>
          <TextOutputDefaultSelect
            value={textOutputDefault as TextOutputDefault}
            onChange={(v) => setTextOutputDefault(v)}
            className={cn(styles.control, styles.selectControl)}
          />
        </div>
        <div className={styles.footer}>
          {dirty && (
            <span
              className={styles.unsavedIndicator}
              data-testid="unsaved-indicator"
            >
              <span className={styles.unsavedDot} />
              有未保存的修改
            </span>
          )}
          <Button variant="primary" disabled={!dirty || update.isPending} onClick={onSave}>
            {update.isPending ? "保存中..." : "保存修改"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
