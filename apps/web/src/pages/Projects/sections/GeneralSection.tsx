import { useEffect, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Card } from "@/components/ui/Card";
import { useToastStore } from "@/components/ui/Toast";
import { useUpdateProject } from "@/hooks/useProjects";
import { PRESET_AI_MODELS, CUSTOM_MODEL_KEY } from "@/constants/projectTypes";
import type { ProjectResponse } from "@/api/projects";

const labelStyle: CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 500,
  color: "var(--color-fg-muted)",
  marginBottom: 6,
};

const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 11px",
  fontSize: 13.5,
  background: "var(--color-bg-sunken)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-md)",
  color: "var(--color-fg)",
  outline: "none",
  fontFamily: "inherit",
};

const STATUS_OPTIONS = [
  { value: "in_progress", label: "进行中" },
  { value: "pending_review", label: "待审核" },
  { value: "completed", label: "已完成" },
  { value: "archived", label: "已归档" },
];

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
  const [iouThreshold, setIouThreshold] = useState(project.iou_dedup_threshold ?? 0.7);

  useEffect(() => {
    setName(project.name);
    setStatus(project.status);
    setDueDate(project.due_date ?? "");
    setClasses(project.classes ?? []);
    setAiEnabled(project.ai_enabled);
    setAiChoice(initialAiChoice);
    setAiCustom(project.ai_model && !PRESET_AI_MODELS.includes(project.ai_model) ? project.ai_model : "");
    setIouThreshold(project.iou_dedup_threshold ?? 0.7);
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
    Math.abs(iouThreshold - (project.iou_dedup_threshold ?? 0.7)) > 0.001;

  const onSave = () => {
    if (!name.trim()) {
      pushToast({ msg: "项目名称不能为空" });
      return;
    }
    if (aiEnabled && !resolvedAiModel) {
      pushToast({ msg: "启用 AI 时需指定模型" });
      return;
    }
    update.mutate(
      {
        name: name.trim(),
        status,
        due_date: dueDate || null,
        classes,
        ai_enabled: aiEnabled,
        ai_model: aiEnabled ? resolvedAiModel : null,
        iou_dedup_threshold: iouThreshold,
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
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)" }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>基本信息</h3>
      </div>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <label style={labelStyle}>项目名称</label>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} style={inputStyle} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={labelStyle}>状态</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>截止日期</label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={inputStyle} />
          </div>
        </div>
        <div>
          <label style={labelStyle}>类型</label>
          <div
            style={{
              padding: "8px 11px",
              fontSize: 13,
              color: "var(--color-fg-muted)",
              background: "var(--color-bg-sunken)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-md)",
            }}
          >
            {project.type_label} <span className="mono" style={{ fontSize: 11, marginLeft: 8, color: "var(--color-fg-subtle)" }}>{project.type_key}</span>
          </div>
        </div>
        <div>
          <label style={labelStyle}>标注类别</label>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
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
              style={{ ...inputStyle, flex: 1 }}
            />
            <Button onClick={addClass} disabled={!classInput.trim()}>
              <Icon name="plus" size={12} />添加
            </Button>
          </div>
          <div
            style={{
              minHeight: 56,
              padding: 10,
              border: "1px dashed var(--color-border)",
              borderRadius: "var(--radius-md)",
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              alignContent: "flex-start",
              background: "var(--color-bg-sunken)",
            }}
          >
            {classes.length === 0 && (
              <span style={{ fontSize: 12, color: "var(--color-fg-subtle)" }}>暂无类别</span>
            )}
            {classes.map((c) => (
              <span
                key={c}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "3px 4px 3px 10px",
                  background: "var(--color-bg-elev)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 100,
                  fontSize: 12,
                }}
              >
                {c}
                <button
                  type="button"
                  onClick={() => setClasses((s) => s.filter((x) => x !== c))}
                  aria-label={`删除 ${c}`}
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--color-fg-muted)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon name="x" size={10} />
                </button>
              </span>
            ))}
          </div>
        </div>
        <div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={aiEnabled}
              onChange={(e) => setAiEnabled(e.target.checked)}
              style={{ accentColor: "var(--color-ai)" }}
            />
            <Icon name="sparkles" size={14} style={{ color: "var(--color-ai)" }} />
            启用 AI 预标注
          </label>
          {aiEnabled && (
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              <select value={aiChoice} onChange={(e) => setAiChoice(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
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
                  style={inputStyle}
                />
              )}
            </div>
          )}
        </div>
        <div>
          <label style={labelStyle}>
            AI 框去重阈值 <span style={{ color: "var(--color-fg-subtle)", fontWeight: 400 }}>（与已确认人工框 IoU 高于此值的同类 AI 框将淡化）</span>
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <input
              type="range"
              min={0.3}
              max={0.95}
              step={0.05}
              value={iouThreshold}
              onChange={(e) => setIouThreshold(Number(e.target.value))}
              style={{ flex: 1, accentColor: "var(--color-ai)" }}
            />
            <span
              className="mono"
              style={{
                minWidth: 48,
                textAlign: "right",
                fontSize: 13,
                color: "var(--color-fg)",
              }}
            >
              {iouThreshold.toFixed(2)}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button variant="primary" disabled={!dirty || update.isPending} onClick={onSave}>
            {update.isPending ? "保存中..." : "保存修改"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
