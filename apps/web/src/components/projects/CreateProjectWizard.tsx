import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { useToastStore } from "@/components/ui/Toast";
import { useCreateProject, useAddProjectMember } from "@/hooks/useProjects";
import { useDatasets, useLinkProject } from "@/hooks/useDatasets";
import { useUsers } from "@/hooks/useUsers";
import { useSplitBatches } from "@/hooks/useBatches";
import {
  PROJECT_TYPES,
  PRESET_AI_MODELS,
  CUSTOM_MODEL_KEY,
} from "@/constants/projectTypes";
import type { ProjectResponse, ClassesConfig } from "@/api/projects";
import type { DatasetResponse } from "@/api/datasets";
import { ClassEditor, defaultColorFor, type ClassRow } from "@/pages/Projects/sections/ClassEditor";

type Step = 1 | 2 | 3 | 4 | 5 | 6;

interface Props {
  open: boolean;
  onClose: () => void;
}

interface FormState {
  name: string;
  typeKey: string;
  dueDate: string;
  // v0.7.0：升级为 ClassRow[]（含颜色），提交时序列化为 classes + classes_config
  classRows: ClassRow[];
  aiEnabled: boolean;
  aiModelChoice: string;
  aiModelCustom: string;
  // v0.6.7 B-11
  datasetIds: string[];
  splitNBatches: number; // 0 = 不切分（保留默认包），>=2 = 切分
  members: { userId: string; role: "annotator" | "reviewer" }[];
}

const INITIAL: FormState = {
  name: "",
  typeKey: "image-det",
  dueDate: "",
  classRows: [],
  aiEnabled: false,
  aiModelChoice: PRESET_AI_MODELS[0],
  aiModelCustom: "",
  datasetIds: [],
  splitNBatches: 0,
  members: [],
};

const STEP_LABELS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: "类型",
  2: "类别",
  3: "AI 接入",
  4: "数据",
  5: "成员",
};

const DRAFT_KEY = "create_project_draft_v0_6_7";

export function CreateProjectWizard({ open, onClose }: Props) {
  const navigate = useNavigate();
  const pushToast = useToastStore((s) => s.push);
  const createProject = useCreateProject();

  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<FormState>(INITIAL);
  const [created, setCreated] = useState<ProjectResponse | null>(null);

  // 草稿恢复 / 持久化
  useEffect(() => {
    if (!open) {
      setStep(1);
      setForm(INITIAL);
      setCreated(null);
      createProject.reset();
      return;
    }
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) setForm({ ...INITIAL, ...JSON.parse(saved) });
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open && !created) {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(form)); } catch {/* */}
    }
  }, [form, open, created]);

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

  const submit = () => {
    if (!step3Valid) return;
    const classes = form.classRows.map((r) => r.name);
    const classes_config: ClassesConfig = {};
    form.classRows.forEach((r, i) => {
      classes_config[r.name] = { color: r.color, order: i };
    });
    createProject.mutate(
      {
        name: trimmedName,
        type_key: selectedType.key,
        type_label: selectedType.label,
        classes,
        classes_config,
        ai_enabled: form.aiEnabled,
        ai_model: form.aiEnabled ? resolvedAiModel : null,
        due_date: form.dueDate || null,
      },
      {
        onSuccess: async (p) => {
          setCreated(p);
          pushToast({ msg: "项目创建成功", sub: p.display_id, kind: "success" });
          // 后续 step 4 / 5 顺序调用其他端点，每步独立失败不阻断
          setStep(4);
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

  // step 4 / 5 完成后的最终落地
  const finishWizard = (linkedDatasets: number, addedMembers: number) => {
    try { localStorage.removeItem(DRAFT_KEY); } catch {/* */}
    setStep(6);
  };

  const stepperCurrent = (step >= 1 && step <= 5 ? step : 5) as 1 | 2 | 3 | 4 | 5;

  return (
    <Modal open={open} onClose={onClose} title={step === 6 ? "创建完成" : "新建项目"} width={620}>
      {step !== 6 && <Stepper current={stepperCurrent} />}

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
          rows={form.classRows}
          onChange={(rows) => setForm((s) => ({ ...s, classRows: rows }))}
        />
      )}

      {step === 3 && (
        <Step3 form={form} setForm={setForm} resolvedAiModel={resolvedAiModel} />
      )}

      {step === 4 && created && (
        <Step4Datasets
          project={created}
          form={form}
          setForm={setForm}
          onNext={(linked) => {
            // 把已选 datasetIds + splitNBatches 应用完成后下一步
            // 实际 link/split 由 Step4Datasets 内部完成 mutation 后调 onNext
            void linked;
            setStep(5);
          }}
        />
      )}

      {step === 5 && created && (
        <Step5Members
          project={created}
          form={form}
          setForm={setForm}
          onNext={(added) => {
            finishWizard(form.datasetIds.length, added);
          }}
        />
      )}

      {step === 6 && created && (
        <SuccessStep
          project={created}
          summary={{
            datasets: form.datasetIds.length,
            members: form.members.length,
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

      {(step === 1 || step === 2 || step === 3) && (
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

function Stepper({ current }: { current: 1 | 2 | 3 | 4 | 5 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", marginBottom: 20 }}>
      {[1, 2, 3, 4, 5].map((n, i) => {
        const active = n === current;
        const done = n < current;
        const color = done || active ? "var(--color-accent)" : "var(--color-fg-subtle)";
        return (
          <div key={n} style={{ display: "flex", alignItems: "center", flex: i < 4 ? 1 : "0 0 auto" }}>
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                background: done || active ? "var(--color-accent)" : "var(--color-bg-sunken)",
                color: done || active ? "#fff" : "var(--color-fg-muted)",
                fontSize: 11,
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                border: active ? "2px solid var(--color-accent-soft)" : "1px solid var(--color-border)",
                flexShrink: 0,
              }}
            >
              {done ? <Icon name="check" size={11} /> : n}
            </div>
            <span style={{ marginLeft: 6, fontSize: 11.5, color, fontWeight: active ? 600 : 500 }}>
              {STEP_LABELS[n as 1 | 2 | 3 | 4 | 5]}
            </span>
            {i < 4 && (
              <div
                style={{
                  flex: 1,
                  height: 1,
                  margin: "0 8px",
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
  rows,
  onChange,
}: {
  rows: ClassRow[];
  onChange: (next: ClassRow[]) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 12.5, color: "var(--color-fg-muted)" }}>
        添加该项目的标注类别（可空，后续可在项目设置中继续编辑）。每个类别可独立配置颜色和顺序；顺序影响数字键 1-9 / a-z 映射。
      </div>
      <ClassEditor value={rows} onChange={onChange} max={50} emptyHint="暂无类别（后续可在项目设置中添加）" />
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

function Step4Datasets({
  project,
  form,
  setForm,
  onNext,
}: {
  project: ProjectResponse;
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  onNext: (linked: number) => void;
}) {
  const pushToast = useToastStore((s) => s.push);
  const { data: datasetsRes, isLoading } = useDatasets();
  const splitMutation = useSplitBatches(project.id);
  // useLinkProject 需要 datasetId 维度的实例，链路上每个 ds 的 mutation 都建一个会失控；
  // 这里走原始 api 直接调（hooks 仅用于 invalidate；step 完成后整体 invalidate 一次足够）。
  const datasets: DatasetResponse[] = datasetsRes?.items ?? [];
  const [linking, setLinking] = useState(false);

  const toggle = (id: string) => {
    setForm((s) => ({
      ...s,
      datasetIds: s.datasetIds.includes(id)
        ? s.datasetIds.filter((x) => x !== id)
        : [...s.datasetIds, id],
    }));
  };

  const onContinue = async () => {
    if (form.datasetIds.length === 0) {
      onNext(0);
      return;
    }
    setLinking(true);
    try {
      const { datasetsApi } = await import("@/api/datasets");
      // 依次 link（保证审计一行一项），失败不阻断
      let linkedOK = 0;
      for (const dsId of form.datasetIds) {
        try {
          await datasetsApi.linkProject(dsId, project.id);
          linkedOK++;
        } catch (e) {
          pushToast({ msg: "数据集关联失败", sub: (e as Error).message, kind: "error" });
        }
      }
      // 切分（仅当用户选了 >=2）
      if (form.splitNBatches >= 2) {
        try {
          await splitMutation.mutateAsync({
            strategy: "random",
            n_batches: form.splitNBatches,
            name_prefix: "Batch",
            priority: 50,
          });
        } catch (e) {
          pushToast({ msg: "批次切分失败（可在设置页重试）", sub: (e as Error).message });
        }
      }
      pushToast({ msg: `已关联 ${linkedOK} 个数据集`, kind: "success" });
      onNext(linkedOK);
    } finally {
      setLinking(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 12.5, color: "var(--color-fg-muted)" }}>
        选择要关联到本项目的数据集（可空 / 多选）。关联后会自动为每个数据集建一个独立批次。
      </div>

      {isLoading && <div style={{ padding: 12, fontSize: 12, color: "var(--color-fg-subtle)" }}>加载数据集…</div>}

      {!isLoading && datasets.length === 0 && (
        <div style={{
          padding: 16, fontSize: 12.5, color: "var(--color-fg-muted)",
          background: "var(--color-bg-sunken)", borderRadius: "var(--radius-md)", textAlign: "center",
        }}>
          暂无可用数据集，可跳过此步骤稍后在「数据集」页关联。
        </div>
      )}

      {!isLoading && datasets.length > 0 && (
        <div style={{
          maxHeight: 220, overflowY: "auto",
          border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)",
          background: "var(--color-bg-sunken)", padding: 6,
        }}>
          {datasets.map((d) => {
            const checked = form.datasetIds.includes(d.id);
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => toggle(d.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 8, width: "100%",
                  padding: "6px 10px",
                  borderRadius: "var(--radius-sm)",
                  background: checked ? "var(--color-accent-soft)" : "transparent",
                  border: `1px solid ${checked ? "var(--color-accent)" : "transparent"}`,
                  cursor: "pointer", textAlign: "left", marginBottom: 2,
                  fontFamily: "inherit", color: "var(--color-fg)",
                }}
              >
                <span style={{
                  width: 14, height: 14, borderRadius: 3,
                  border: "1px solid var(--color-border)",
                  background: checked ? "var(--color-accent)" : "var(--color-bg)",
                  color: "#fff",
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}>
                  {checked && <Icon name="check" size={10} />}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 500 }}>{d.name}</div>
                  <div style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>
                    <span className="mono">{d.display_id}</span> · {d.file_count} 个文件 · {d.data_type}
                  </div>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {form.datasetIds.length > 0 && (
        <div style={{
          padding: 10, border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-md)", background: "var(--color-bg-sunken)",
        }}>
          <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 8 }}>
            关联后的初始分包
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 12 }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input
                type="radio"
                checked={form.splitNBatches === 0}
                onChange={() => setForm((s) => ({ ...s, splitNBatches: 0 }))}
              />
              保留默认包（每个数据集一个包）
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input
                type="radio"
                checked={form.splitNBatches >= 2}
                onChange={() => setForm((s) => ({ ...s, splitNBatches: Math.max(2, s.splitNBatches) }))}
              />
              随机切分为
              <input
                type="number" min={2} max={20}
                value={form.splitNBatches >= 2 ? form.splitNBatches : 3}
                disabled={form.splitNBatches < 2}
                onChange={(e) => setForm((s) => ({ ...s, splitNBatches: Math.max(2, Math.min(20, Number(e.target.value))) }))}
                style={{ ...inputStyle, width: 56, padding: "4px 8px", fontSize: 12 }}
              />
              个批次
            </label>
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8, paddingTop: 14, borderTop: "1px solid var(--color-border)" }}>
        <Button variant="ghost" onClick={() => onNext(0)} disabled={linking}>跳过</Button>
        <Button variant="primary" onClick={onContinue} disabled={linking}>
          {linking ? "关联中…" : form.datasetIds.length === 0 ? "下一步" : `关联 ${form.datasetIds.length} 个并继续`}
        </Button>
      </div>
    </div>
  );
}

function Step5Members({
  project,
  form,
  setForm,
  onNext,
}: {
  project: ProjectResponse;
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  onNext: (added: number) => void;
}) {
  const pushToast = useToastStore((s) => s.push);
  const addMember = useAddProjectMember(project.id);
  const { data: users = [], isLoading } = useUsers();
  const [adding, setAdding] = useState(false);

  // 仅展示 annotator / reviewer 角色用户（项目成员只能这两个角色）
  const eligible = users.filter((u) => u.role === "annotator" || u.role === "reviewer");

  const toggle = (userId: string, role: "annotator" | "reviewer") => {
    setForm((s) => {
      const exists = s.members.find((m) => m.userId === userId);
      if (exists) return { ...s, members: s.members.filter((m) => m.userId !== userId) };
      return { ...s, members: [...s.members, { userId, role }] };
    });
  };

  const onContinue = async () => {
    if (form.members.length === 0) {
      onNext(0);
      return;
    }
    setAdding(true);
    let ok = 0;
    for (const m of form.members) {
      try {
        await addMember.mutateAsync({ user_id: m.userId, role: m.role });
        ok++;
      } catch (e) {
        pushToast({ msg: "添加成员失败", sub: (e as Error).message, kind: "error" });
      }
    }
    setAdding(false);
    pushToast({ msg: `已添加 ${ok} 位成员`, kind: "success" });
    onNext(ok);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 12.5, color: "var(--color-fg-muted)" }}>
        选择标注员 / 审核员（可空）。每位成员的角色由其账户角色决定。
      </div>

      {isLoading && <div style={{ padding: 12, fontSize: 12, color: "var(--color-fg-subtle)" }}>加载用户…</div>}

      {!isLoading && eligible.length === 0 && (
        <div style={{
          padding: 16, fontSize: 12.5, color: "var(--color-fg-muted)",
          background: "var(--color-bg-sunken)", borderRadius: "var(--radius-md)", textAlign: "center",
        }}>
          暂无 annotator / reviewer 角色的用户，可跳过此步骤。
        </div>
      )}

      {!isLoading && eligible.length > 0 && (
        <div style={{
          maxHeight: 240, overflowY: "auto",
          border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)",
          background: "var(--color-bg-sunken)", padding: 6,
        }}>
          {eligible.map((u) => {
            const checked = form.members.some((m) => m.userId === u.id);
            const role = (u.role === "reviewer" ? "reviewer" : "annotator") as "annotator" | "reviewer";
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => toggle(u.id, role)}
                style={{
                  display: "flex", alignItems: "center", gap: 8, width: "100%",
                  padding: "6px 10px",
                  borderRadius: "var(--radius-sm)",
                  background: checked ? "var(--color-accent-soft)" : "transparent",
                  border: `1px solid ${checked ? "var(--color-accent)" : "transparent"}`,
                  cursor: "pointer", textAlign: "left", marginBottom: 2,
                  fontFamily: "inherit", color: "var(--color-fg)",
                }}
              >
                <span style={{
                  width: 14, height: 14, borderRadius: 3,
                  border: "1px solid var(--color-border)",
                  background: checked ? "var(--color-accent)" : "var(--color-bg)",
                  color: "#fff",
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}>
                  {checked && <Icon name="check" size={10} />}
                </span>
                <Avatar initial={(u.name || u.email).slice(0, 1).toUpperCase()} size="sm" />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 500 }}>{u.name || u.email}</div>
                  <div style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>{u.email}</div>
                </span>
                <Badge variant={role === "reviewer" ? "warning" : "accent"}>
                  {role === "reviewer" ? "审核员" : "标注员"}
                </Badge>
              </button>
            );
          })}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8, paddingTop: 14, borderTop: "1px solid var(--color-border)" }}>
        <Button variant="ghost" onClick={() => onNext(0)} disabled={adding}>跳过</Button>
        <Button variant="primary" onClick={onContinue} disabled={adding}>
          {adding ? "添加中…" : form.members.length === 0 ? "完成" : `添加 ${form.members.length} 位并完成`}
        </Button>
      </div>
    </div>
  );
}

function SuccessStep({
  project,
  summary,
  onOpenProject,
  onOpenSettings,
  onDone,
}: {
  project: ProjectResponse;
  summary: { datasets: number; members: number };
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
      <div style={{ fontSize: 12, color: "var(--color-fg-subtle)", marginBottom: 18, textAlign: "center", maxWidth: 400 }}>
        已关联 {summary.datasets} 个数据集 · 已添加 {summary.members} 位成员
        {summary.datasets === 0 && (
          <div style={{ marginTop: 4, color: "var(--color-warning)" }}>
            尚未关联数据集，可去设置页继续配置
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
        <Button variant="primary" onClick={onOpenSettings}>
          <Icon name="settings" size={12} />项目设置
        </Button>
        {canOpen && (
          <Button onClick={onOpenProject}>
            <Icon name="target" size={12} />打开工作台
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
