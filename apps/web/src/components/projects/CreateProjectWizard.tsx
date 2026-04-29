import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Badge } from "@/components/ui/Badge";
import { useToastStore } from "@/components/ui/Toast";
import { useCreateProject } from "@/hooks/useProjects";
import {
  PROJECT_TYPES,
  PRESET_AI_MODELS,
  CUSTOM_MODEL_KEY,
} from "@/constants/projectTypes";
import type { ProjectResponse } from "@/api/projects";

type Step = 1 | 2 | 3 | 4;

interface Props {
  open: boolean;
  onClose: () => void;
}

interface FormState {
  name: string;
  typeKey: string;
  dueDate: string;
  classes: string[];
  aiEnabled: boolean;
  aiModelChoice: string;
  aiModelCustom: string;
}

const INITIAL: FormState = {
  name: "",
  typeKey: "image-det",
  dueDate: "",
  classes: [],
  aiEnabled: false,
  aiModelChoice: PRESET_AI_MODELS[0],
  aiModelCustom: "",
};

const STEP_LABELS: Record<1 | 2 | 3, string> = {
  1: "类型",
  2: "类别",
  3: "AI 接入",
};

export function CreateProjectWizard({ open, onClose }: Props) {
  const navigate = useNavigate();
  const pushToast = useToastStore((s) => s.push);
  const createProject = useCreateProject();

  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<FormState>(INITIAL);
  const [classInput, setClassInput] = useState("");
  const [created, setCreated] = useState<ProjectResponse | null>(null);

  // 模态关闭时重置（短延时让动画可拓展）
  useEffect(() => {
    if (!open) {
      setStep(1);
      setForm(INITIAL);
      setClassInput("");
      setCreated(null);
      createProject.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const selectedType = useMemo(
    () => PROJECT_TYPES.find((t) => t.key === form.typeKey) ?? PROJECT_TYPES[0],
    [form.typeKey],
  );

  const trimmedName = form.name.trim();
  const nameValid = trimmedName.length >= 2 && trimmedName.length <= 60;
  const dueValid = !form.dueDate || form.dueDate >= new Date().toISOString().slice(0, 10);
  const step1Valid = nameValid && !!form.typeKey && dueValid;

  const resolvedAiModel = form.aiModelChoice === CUSTOM_MODEL_KEY
    ? form.aiModelCustom.trim()
    : form.aiModelChoice;
  const step3Valid = !form.aiEnabled || resolvedAiModel.length > 0;

  const addClass = () => {
    const v = classInput.trim();
    if (!v || v.length > 30) return;
    if (form.classes.includes(v)) {
      setClassInput("");
      return;
    }
    setForm((s) => ({ ...s, classes: [...s.classes, v] }));
    setClassInput("");
  };

  const removeClass = (c: string) =>
    setForm((s) => ({ ...s, classes: s.classes.filter((x) => x !== c) }));

  const submit = () => {
    if (!step3Valid) return;
    createProject.mutate(
      {
        name: trimmedName,
        type_key: selectedType.key,
        type_label: selectedType.label,
        classes: form.classes,
        ai_enabled: form.aiEnabled,
        ai_model: form.aiEnabled ? resolvedAiModel : null,
        due_date: form.dueDate || null,
      },
      {
        onSuccess: (p) => {
          setCreated(p);
          setStep(4);
          pushToast({ msg: "项目创建成功", sub: p.display_id, kind: "success" });
        },
        onError: (err) => {
          pushToast({
            msg: "创建失败",
            sub: (err as Error)?.message ?? "请稍后重试",
          });
        },
      },
    );
  };

  return (
    <Modal open={open} onClose={onClose} title={step === 4 ? "创建成功" : "新建项目"} width={580}>
      {step !== 4 && <Stepper current={step} />}

      {step === 1 && (
        <Step1
          form={form}
          setForm={setForm}
          nameValid={nameValid || trimmedName.length === 0}
          dueValid={dueValid}
        />
      )}

      {step === 2 && (
        <Step2
          classes={form.classes}
          input={classInput}
          setInput={setClassInput}
          addClass={addClass}
          removeClass={removeClass}
        />
      )}

      {step === 3 && (
        <Step3 form={form} setForm={setForm} resolvedAiModel={resolvedAiModel} />
      )}

      {step === 4 && created && (
        <SuccessStep
          project={created}
          onLinkDataset={() => {
            onClose();
            navigate("/datasets");
          }}
          onOpenProject={() => {
            onClose();
            navigate(`/projects/${created.id}/annotate`);
          }}
          onOpenSettings={() => {
            onClose();
            navigate(`/projects/${created.id}/settings`);
          }}
          onDone={onClose}
        />
      )}

      {step !== 4 && (
        <Footer
          step={step}
          canNext={
            (step === 1 && step1Valid) ||
            step === 2 ||
            (step === 3 && step3Valid)
          }
          loading={createProject.isPending}
          onCancel={onClose}
          onPrev={() => setStep((s) => (s > 1 ? ((s - 1) as Step) : s))}
          onNext={() => {
            if (step === 1) setStep(2);
            else if (step === 2) setStep(3);
            else submit();
          }}
        />
      )}
    </Modal>
  );
}

function Stepper({ current }: { current: 1 | 2 | 3 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", marginBottom: 20 }}>
      {[1, 2, 3].map((n, i) => {
        const active = n === current;
        const done = n < current;
        const color = done || active ? "var(--color-accent)" : "var(--color-fg-subtle)";
        return (
          <div key={n} style={{ display: "flex", alignItems: "center", flex: i < 2 ? 1 : "0 0 auto" }}>
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: "50%",
                background: done || active ? "var(--color-accent)" : "var(--color-bg-sunken)",
                color: done || active ? "#fff" : "var(--color-fg-muted)",
                fontSize: 12,
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                border: active ? "2px solid var(--color-accent-soft)" : "1px solid var(--color-border)",
                flexShrink: 0,
              }}
            >
              {done ? <Icon name="check" size={12} /> : n}
            </div>
            <span style={{ marginLeft: 8, fontSize: 12, color, fontWeight: active ? 600 : 500 }}>
              {STEP_LABELS[n as 1 | 2 | 3]}
            </span>
            {i < 2 && (
              <div
                style={{
                  flex: 1,
                  height: 1,
                  margin: "0 12px",
                  background: n < current ? "var(--color-accent)" : "var(--color-border)",
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

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
  transition: "border-color 0.15s",
  fontFamily: "inherit",
};

function Step1({
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
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <label style={labelStyle}>项目名称</label>
        <input
          value={form.name}
          onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
          placeholder="如:智能门店货架商品检测"
          maxLength={60}
          style={{
            ...inputStyle,
            borderColor: nameValid ? "var(--color-border)" : "var(--color-danger)",
          }}
        />
        {!nameValid && (
          <div style={{ fontSize: 11, color: "var(--color-danger)", marginTop: 4 }}>
            名称需 2-60 字符
          </div>
        )}
      </div>

      <div>
        <label style={labelStyle}>数据类型</label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
          {PROJECT_TYPES.map((t) => {
            const active = t.key === form.typeKey;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setForm((s) => ({ ...s, typeKey: t.key }))}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  background: active ? "var(--color-accent-soft)" : "var(--color-bg-sunken)",
                  border: `1px solid ${active ? "var(--color-accent)" : "var(--color-border)"}`,
                  borderRadius: "var(--radius-md)",
                  cursor: "pointer",
                  textAlign: "left",
                  color: "var(--color-fg)",
                  fontFamily: "inherit",
                }}
              >
                <span
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 6,
                    background: active ? "var(--color-accent)" : "var(--color-bg-elev)",
                    color: active ? "#fff" : "var(--color-fg-muted)",
                    border: "1px solid var(--color-border)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Icon name={t.icon} size={14} />
                </span>
                <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{t.label}</span>
                  <span style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>{t.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label style={labelStyle}>截止日期（可空）</label>
        <input
          type="date"
          value={form.dueDate}
          onChange={(e) => setForm((s) => ({ ...s, dueDate: e.target.value }))}
          style={{
            ...inputStyle,
            borderColor: dueValid ? "var(--color-border)" : "var(--color-danger)",
          }}
        />
        {!dueValid && (
          <div style={{ fontSize: 11, color: "var(--color-danger)", marginTop: 4 }}>
            截止日期不能早于今天
          </div>
        )}
      </div>
    </div>
  );
}

function Step2({
  classes,
  input,
  setInput,
  addClass,
  removeClass,
}: {
  classes: string[];
  input: string;
  setInput: (v: string) => void;
  addClass: () => void;
  removeClass: (c: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 12.5, color: "var(--color-fg-muted)" }}>
        添加该项目的标注类别（可空，后续可在项目设置中调整）。回车快速添加。
      </div>

      <div style={{ display: "flex", gap: 6 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addClass();
            }
          }}
          placeholder="如:商品 / 价签"
          maxLength={30}
          style={{ ...inputStyle, flex: 1 }}
        />
        <Button onClick={addClass} disabled={!input.trim()}>
          <Icon name="plus" size={12} />添加
        </Button>
      </div>

      <div
        style={{
          minHeight: 80,
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
              color: "var(--color-fg)",
            }}
          >
            {c}
            <button
              type="button"
              onClick={() => removeClass(c)}
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
  );
}

function Step3({
  form,
  setForm,
  resolvedAiModel,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  resolvedAiModel: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-md)",
          background: form.aiEnabled ? "var(--color-ai-soft)" : "var(--color-bg-sunken)",
          cursor: "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={form.aiEnabled}
          onChange={(e) => setForm((s) => ({ ...s, aiEnabled: e.target.checked }))}
          style={{ accentColor: "var(--color-ai)", margin: 0 }}
        />
        <Icon name="sparkles" size={14} style={{ color: "var(--color-ai)" }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>启用 AI 预标注</span>
          <span style={{ fontSize: 11, color: "var(--color-fg-muted)" }}>
            创建后可在项目内挂接真实 ML Backend 推理服务
          </span>
        </div>
      </label>

      {form.aiEnabled && (
        <>
          <div>
            <label style={labelStyle}>模型</label>
            <select
              value={form.aiModelChoice}
              onChange={(e) => setForm((s) => ({ ...s, aiModelChoice: e.target.value }))}
              style={{ ...inputStyle, cursor: "pointer" }}
            >
              {PRESET_AI_MODELS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
              <option value={CUSTOM_MODEL_KEY}>自定义...</option>
            </select>
          </div>

          {form.aiModelChoice === CUSTOM_MODEL_KEY && (
            <div>
              <label style={labelStyle}>自定义模型名称</label>
              <input
                value={form.aiModelCustom}
                onChange={(e) => setForm((s) => ({ ...s, aiModelCustom: e.target.value }))}
                placeholder="如:MyDet-v1"
                maxLength={120}
                style={inputStyle}
              />
            </div>
          )}

          <div
            style={{
              padding: "8px 10px",
              fontSize: 11.5,
              color: "var(--color-fg-muted)",
              background: "var(--color-bg-sunken)",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--color-border)",
            }}
          >
            <span style={{ color: "var(--color-fg)" }}>当前模型:</span>{" "}
            <Badge variant="ai">
              <Icon name="sparkles" size={10} />
              {resolvedAiModel || "—"}
            </Badge>
          </div>
        </>
      )}
    </div>
  );
}

function SuccessStep({
  project,
  onLinkDataset,
  onOpenProject,
  onOpenSettings,
  onDone,
}: {
  project: ProjectResponse;
  onLinkDataset: () => void;
  onOpenProject: () => void;
  onOpenSettings: () => void;
  onDone: () => void;
}) {
  const canOpen = project.type_key === "image-det";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 0 4px" }}>
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: "var(--color-success-soft)",
          color: "var(--color-success)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 14,
        }}
      >
        <Icon name="check" size={28} />
      </div>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>{project.name}</div>
      <div style={{ fontSize: 12, color: "var(--color-fg-muted)", marginBottom: 4 }}>
        <span className="mono">{project.display_id}</span> · {project.type_label}
      </div>
      <div style={{ fontSize: 12, color: "var(--color-fg-subtle)", marginBottom: 22, textAlign: "center", maxWidth: 380 }}>
        项目已创建。下一步推荐去关联数据集，或直接进入标注工作台。
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
        <Button variant="primary" onClick={onLinkDataset}>
          <Icon name="link" size={12} />关联数据集
        </Button>
        <Button onClick={onOpenSettings}>
          <Icon name="settings" size={12} />项目设置
        </Button>
        {canOpen && (
          <Button onClick={onOpenProject}>
            <Icon name="target" size={12} />打开项目
          </Button>
        )}
        <Button variant="ghost" onClick={onDone}>完成</Button>
      </div>
    </div>
  );
}

function Footer({
  step,
  canNext,
  loading,
  onCancel,
  onPrev,
  onNext,
}: {
  step: 1 | 2 | 3;
  canNext: boolean;
  loading: boolean;
  onCancel: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "flex-end",
        gap: 8,
        marginTop: 22,
        paddingTop: 14,
        borderTop: "1px solid var(--color-border)",
      }}
    >
      <Button variant="ghost" onClick={onCancel}>取消</Button>
      {step > 1 && (
        <Button onClick={onPrev}>
          <Icon name="chevLeft" size={12} />上一步
        </Button>
      )}
      <Button variant="primary" onClick={onNext} disabled={!canNext || loading}>
        {step === 3 ? (loading ? "创建中..." : "创建") : "下一步"}
        {step < 3 && <Icon name="chevRight" size={12} />}
      </Button>
    </div>
  );
}
