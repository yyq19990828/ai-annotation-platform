import { useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { adminMlIntegrationsApi } from "@/api/adminMlIntegrations";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { useToastStore } from "@/components/ui/Toast";
import { useCreateProject, useAddProjectMember } from "@/hooks/useProjects";
import { useDatasets } from "@/hooks/useDatasets";
import { useUsers } from "@/hooks/useUsers";
import { useSplitBatches } from "@/hooks/useBatches";
import {
  PROJECT_TYPES,
  PRESET_AI_MODELS,
  CUSTOM_MODEL_KEY,
} from "@/constants/projectTypes";
import { projectsApi, type ProjectResponse, type ClassesConfig, type AttributeField, type AttributeSchema } from "@/api/projects";
import { projectTemplatesApi, type ProjectTemplateOut } from "@/api/projectTemplates";
import type { ClassConfigEntry } from "@/api/projects";
import type { DatasetResponse } from "@/api/datasets";
import { ClassEditor, type ClassRow } from "@/pages/Projects/sections/ClassEditor";
import { TextOutputDefaultSelect } from "@/components/projects/shared/TextOutputDefaultSelect";
import { AttributeSchemaEditor, validateAttributeFields } from "@/pages/Projects/sections/AttributeSchemaEditor";
import styles from "./CreateProjectWizard.module.css";

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7;

interface Props {
  open: boolean;
  onClose: () => void;
  /** v0.10.11 · 给定时, 打开后以此项目为模板预填 FormState; 提交时携带
   *  source_project_id, 后端用源项目兜底未显式给出的字段. */
  sourceProjectId?: string;
  /** v0.10.14 · E2 · 从 ProjectTemplate 应用模板. 与 sourceProjectId 互斥
   *  (调用方保证). 给定时预填 FormState + 提交携带 template_id, 后端 usage_count + 1. */
  templateId?: string;
}

interface FormState {
  name: string;
  typeKey: string;
  dueDate: string;
  // v0.7.0：升级为 ClassRow[]（含颜色），提交时序列化为 classes + classes_config
  classRows: ClassRow[];
  // v0.7.6：属性 schema 步骤；提交时序列化为 attribute_schema = { fields }
  attributeFields: AttributeField[];
  aiEnabled: boolean;
  aiModelChoice: string;
  aiModelCustom: string;
  /** v0.9.6 · SAM 文本预标默认输出 ("" = 自动按 type_key, 与 GeneralSection 4 项一致). */
  textOutputDefault: "" | "box" | "mask" | "both";
  /** v0.9.7 · 复用现有 backend; "" = 暂不绑定 (项目创建后到设置页注册). */
  mlBackendSourceId: string;
  // v0.6.7 B-11
  datasetIds: string[];
  splitNBatches: number; // 0 = 不切分（保留默认包），>=2 = 切分
  members: { userId: string; role: "annotator" | "reviewer" }[];
  // v0.10.13 · E1 · 复制模式下是否同时携带源项目的 annotation_guide + guide_assets.
  // 仅 sourceProjectId 给定时显示 UI; 默认 true.
  copyAnnotationGuide: boolean;
}

const INITIAL: FormState = {
  name: "",
  typeKey: "image-det",
  dueDate: "",
  classRows: [],
  attributeFields: [],
  aiEnabled: false,
  aiModelChoice: PRESET_AI_MODELS[0],
  aiModelCustom: "",
  textOutputDefault: "",
  mlBackendSourceId: "",
  datasetIds: [],
  splitNBatches: 0,
  members: [],
  copyAnnotationGuide: true,
};

type StepperStep = 1 | 2 | 3 | 4 | 5 | 6;

const STEP_LABELS: Record<StepperStep, string> = {
  1: "类型",
  2: "类别",
  3: "属性",
  4: "AI 接入",
  5: "数据",
  6: "成员",
};

// v0.7.6：扩为 6 步（+属性 schema），bump 草稿 key 防止旧 5 步草稿污染。
const DRAFT_KEY = "create_project_draft_v0_7_6";

/** v0.10.11 · 把 ProjectResponse 的可克隆配置字段还原为 Wizard FormState. 不包含
 *  运行时数据 (datasets / tasks / members / batches); 后端 source_project_id 兜底
 *  那些不在表单中的字段 (label_config / sampling / rendering_config 等). */
function buildFormFromSource(src: ProjectResponse): FormState {
  const classesConfig: ClassesConfig = (src.classes_config ?? {}) as ClassesConfig;
  const orderedClasses = [...(src.classes ?? [])].sort((a, b) => {
    const oa = classesConfig[a]?.order ?? 0;
    const ob = classesConfig[b]?.order ?? 0;
    return oa - ob;
  });
  const classRows: ClassRow[] = orderedClasses.map((name) => {
    const cfg: ClassConfigEntry | undefined = classesConfig[name];
    return {
      name,
      color: cfg?.color ?? "#888888",
      ...(cfg?.alias ? { alias: cfg.alias } : {}),
    };
  });
  const attributeFields: AttributeField[] =
    (src.attribute_schema as AttributeSchema | undefined)?.fields ?? [];
  const aiModel = src.ai_model ?? "";
  const aiModelChoice = aiModel && PRESET_AI_MODELS.includes(aiModel)
    ? aiModel
    : aiModel
      ? CUSTOM_MODEL_KEY
      : PRESET_AI_MODELS[0];
  const aiModelCustom = aiModel && !PRESET_AI_MODELS.includes(aiModel) ? aiModel : "";
  const textOutputDefault =
    src.text_output_default === "box" || src.text_output_default === "mask" ||
    src.text_output_default === "both"
      ? src.text_output_default
      : "";
  return {
    ...INITIAL,
    name: src.name ? `${src.name} (副本)` : "",
    typeKey: src.type_key,
    classRows,
    attributeFields,
    aiEnabled: src.ai_enabled,
    aiModelChoice,
    aiModelCustom,
    textOutputDefault,
    mlBackendSourceId: src.ml_backend_id ?? "",
    // datasets / batches / members / dueDate 留空 — 这些是运行时数据
  };
}

/** v0.10.14 · E2 · 从模板还原 FormState. 模板字段集合与 source 项目相近, 但
 *  没有 ml_backend_id (模板不绑 backend), 也没有 dataset/members 等运行时数据. */
function buildFormFromTemplate(t: ProjectTemplateOut): FormState {
  const classesConfig: ClassesConfig = (t.classes_config ?? {}) as ClassesConfig;
  const orderedClasses = [...(t.classes ?? [])].sort((a, b) => {
    const oa = classesConfig[a]?.order ?? 0;
    const ob = classesConfig[b]?.order ?? 0;
    return oa - ob;
  });
  const classRows: ClassRow[] = orderedClasses.map((name) => {
    const cfg: ClassConfigEntry | undefined = classesConfig[name];
    return {
      name,
      color: cfg?.color ?? "#888888",
      ...(cfg?.alias ? { alias: cfg.alias } : {}),
    };
  });
  const attributeFields: AttributeField[] =
    (t.attribute_schema as AttributeSchema | undefined)?.fields ?? [];
  const aiModel = t.ai_model ?? "";
  const aiModelChoice = aiModel && PRESET_AI_MODELS.includes(aiModel)
    ? aiModel
    : aiModel
      ? CUSTOM_MODEL_KEY
      : PRESET_AI_MODELS[0];
  const aiModelCustom = aiModel && !PRESET_AI_MODELS.includes(aiModel) ? aiModel : "";
  const textOutputDefault =
    t.text_output_default === "box" || t.text_output_default === "mask" ||
    t.text_output_default === "both"
      ? t.text_output_default
      : "";
  return {
    ...INITIAL,
    name: "",
    typeKey: t.type_key,
    classRows,
    attributeFields,
    aiEnabled: t.ai_enabled,
    aiModelChoice,
    aiModelCustom,
    textOutputDefault,
  };
}

export function CreateProjectWizard({ open, onClose, sourceProjectId, templateId }: Props) {
  const navigate = useNavigate();
  const pushToast = useToastStore((s) => s.push);
  const createProject = useCreateProject();

  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<FormState>(INITIAL);
  const [created, setCreated] = useState<ProjectResponse | null>(null);
  // v0.10.11 · "从已有项目复制" — 拉源项目并 prefill 一次. 失败时 toast + 退化为
  // 普通新建 (不阻塞 Wizard 流程).
  const [prefilling, setPrefilling] = useState(false);

  // 草稿恢复 / 持久化 — v0.10.11 · 复制模式下跳过草稿 (避免与他人项目混合),
  // 改为拉源项目 prefill.
  useEffect(() => {
    if (!open) {
      setStep(1);
      setForm(INITIAL);
      setCreated(null);
      setPrefilling(false);
      createProject.reset();
      return;
    }
    if (sourceProjectId) {
      let cancelled = false;
      setPrefilling(true);
      projectsApi
        .get(sourceProjectId)
        .then((src) => {
          if (cancelled) return;
          setForm(buildFormFromSource(src));
        })
        .catch((e) => {
          if (cancelled) return;
          pushToast({
            msg: "源项目读取失败, 走普通新建",
            sub: (e as Error)?.message ?? "请稍后重试",
            kind: "error",
          });
        })
        .finally(() => {
          if (!cancelled) setPrefilling(false);
        });
      return () => {
        cancelled = true;
      };
    }
    if (templateId) {
      let cancelled = false;
      setPrefilling(true);
      projectTemplatesApi
        .get(templateId)
        .then((t) => {
          if (cancelled) return;
          setForm(buildFormFromTemplate(t));
        })
        .catch((e) => {
          if (cancelled) return;
          pushToast({
            msg: "模板读取失败, 走普通新建",
            sub: (e as Error)?.message ?? "请稍后重试",
            kind: "error",
          });
        })
        .finally(() => {
          if (!cancelled) setPrefilling(false);
        });
      return () => {
        cancelled = true;
      };
    }
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) setForm({ ...INITIAL, ...JSON.parse(saved) });
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sourceProjectId, templateId]);

  useEffect(() => {
    // v0.10.11 · 复制模式不写草稿 (避免下次普通新建被他人项目模板污染).
    // v0.10.14 · E2 · 模板模式同理.
    if (open && !created && !sourceProjectId && !templateId) {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(form)); } catch {/* */}
    }
  }, [form, open, created, sourceProjectId, templateId]);

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
  const step4Valid = !form.aiEnabled || resolvedAiModel.length > 0;
  // step 3 属性 schema：用 AttributeSchemaEditor 自带校验复用；空数组合法（可跳过）
  const step3AttrError = form.attributeFields.length === 0
    ? null
    : validateAttributeFields(form.attributeFields);
  const step3Valid = step3AttrError === null;

  const submit = () => {
    if (!step4Valid) return;
    if (step3AttrError) {
      pushToast({ msg: step3AttrError, kind: "error" });
      return;
    }
    const classes = form.classRows.map((r) => r.name);
    const classes_config: ClassesConfig = {};
    form.classRows.forEach((r, i) => {
      classes_config[r.name] = {
        color: r.color,
        order: i,
        ...(r.alias ? { alias: r.alias } : {}),
      };
    });
    const attribute_schema: AttributeSchema | undefined =
      form.attributeFields.length > 0 ? { fields: form.attributeFields } : undefined;
    createProject.mutate(
      {
        name: trimmedName,
        type_key: selectedType.key,
        type_label: selectedType.label,
        classes,
        classes_config,
        attribute_schema,
        ai_enabled: form.aiEnabled,
        ai_model: form.aiEnabled ? resolvedAiModel : null,
        // v0.9.6 · 仅启用 AI 时携带; "" = null (走智能默认)
        text_output_default:
          form.aiEnabled && form.textOutputDefault ? form.textOutputDefault : null,
        // v0.9.7 · 仅启用 AI 且选了 source backend 时携带; 后端会复制 row 入新项目
        ml_backend_source_id:
          form.aiEnabled && form.mlBackendSourceId ? form.mlBackendSourceId : null,
        // v0.10.11 · "从已有项目复制" — 给后端兜底未显式给出的字段 (例如 label_config /
        // rendering_config / iou_dedup_threshold / sampling 等不在 wizard 表单内的项).
        source_project_id: sourceProjectId ?? null,
        // v0.10.13 · E1 · 仅复制模式下传该 flag; 后端校验若无 source_project_id 会返 400.
        copy_annotation_guide: sourceProjectId ? form.copyAnnotationGuide : undefined,
        // v0.10.14 · E2 · 模板模式下携带 template_id; 后端 deepcopy 模板载荷 +
        // usage_count + 1. 与 source_project_id 互斥, schema 已校验.
        template_id: templateId ?? null,
        due_date: form.dueDate || null,
      },
      {
        onSuccess: async (p) => {
          setCreated(p);
          pushToast({ msg: "项目创建成功", sub: p.display_id, kind: "success" });
          // 后续 step 5 / 6 顺序调用其他端点，每步独立失败不阻断
          setStep(5);
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

  // step 5 / 6 完成后的最终落地
  const finishWizard = (_linkedDatasets: number, _addedMembers: number) => {
    try { localStorage.removeItem(DRAFT_KEY); } catch {/* */}
    setStep(7);
  };

  const stepperCurrent = (step >= 1 && step <= 6 ? step : 6) as StepperStep;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        step === 7
          ? "创建完成"
          : templateId
            ? "从模板创建项目"
            : sourceProjectId
              ? "复制项目配置"
              : "新建项目"
      }
      width={620}
    >
      {step !== 7 && <Stepper current={stepperCurrent} />}
      {/* v0.10.14 · E2 · 模板模式: 顶部横幅 + 加载态. */}
      {templateId && !sourceProjectId && step !== 7 && (
        <div className={styles.copyBanner}>
          <Icon name="book" size={12} />
          {prefilling
            ? "正在从模板加载配置…"
            : "已用模板字段预填表单, 提交后将复制到新项目 (模板的 annotation_guide 也会一并应用; guide_assets 不携带)"}
        </div>
      )}
      {/* v0.10.11 · 复制模式: 顶部横幅 + 加载态. */}
      {sourceProjectId && step !== 7 && (
        <div className={styles.copyBanner}>
          <Icon name="copy" size={12} />
          {prefilling
            ? "正在从源项目加载配置…"
            : "已用源项目配置预填表单, 提交后将复制到新项目 (不复制数据集 / 任务 / 成员)"}
          {!prefilling && (
            <label className={styles.copyGuideToggle}>
              <input
                type="checkbox"
                checked={form.copyAnnotationGuide}
                onChange={(e) =>
                  setForm((s) => ({ ...s, copyAnnotationGuide: e.target.checked }))
                }
              />
              同时复制标注指引（图片资源与源项目共享存储）
            </label>
          )}
        </div>
      )}

      {step === 1 && (
        <Step1
          form={form}
          setForm={setForm}
          nameValid={nameValid || trimmedName.length === 0}
          dueValid={dueValid}
        />
      )}

      {step === 2 && (
        <Step2Classes
          rows={form.classRows}
          onChange={(rows) => setForm((s) => ({ ...s, classRows: rows }))}
        />
      )}

      {step === 3 && (
        <Step3Attributes
          fields={form.attributeFields}
          onChange={(fields) => setForm((s) => ({ ...s, attributeFields: fields }))}
          error={step3AttrError}
        />
      )}

      {step === 4 && (
        <Step4Ai form={form} setForm={setForm} resolvedAiModel={resolvedAiModel} />
      )}

      {step === 5 && created && (
        <Step5Datasets
          project={created}
          form={form}
          setForm={setForm}
          onNext={(linked) => {
            void linked;
            setStep(6);
          }}
        />
      )}

      {step === 6 && created && (
        <Step6Members
          project={created}
          form={form}
          setForm={setForm}
          onNext={(added) => {
            finishWizard(form.datasetIds.length, added);
          }}
        />
      )}

      {step === 7 && created && (
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

      {(step === 1 || step === 2 || step === 3 || step === 4) && (
        <Footer
          step={step}
          canNext={
            (step === 1 && step1Valid) ||
            step === 2 ||
            (step === 3 && step3Valid) ||
            (step === 4 && step4Valid)
          }
          loading={createProject.isPending}
          onCancel={onClose}
          onPrev={() => setStep((s) => (s > 1 ? ((s - 1) as Step) : s))}
          onNext={() => {
            if (step === 1) setStep(2);
            else if (step === 2) setStep(3);
            else if (step === 3) setStep(4);
            else submit();
          }}
        />
      )}
    </Modal>
  );
}

function Stepper({ current }: { current: StepperStep }) {
  const steps: StepperStep[] = [1, 2, 3, 4, 5, 6];
  const lastIdx = steps.length - 1;
  return (
    <div className={styles.stepper}>
      {steps.map((n, i) => {
        const active = n === current;
        const done = n < current;
        return (
          <div key={n} className={clsx(styles.stepperItem, i < lastIdx && styles.stepperItemGrow)}>
            <div
              className={clsx(
                styles.stepperDot,
                (done || active) && styles.stepperDotActive,
                active && styles.stepperDotCurrent,
              )}
            >
              {done ? <Icon name="check" size={11} /> : n}
            </div>
            <span className={clsx(styles.stepperLabel, (done || active) && styles.stepperLabelActive, active && styles.stepperLabelCurrent)}>
              {STEP_LABELS[n]}
            </span>
            {i < lastIdx && (
              <div className={clsx(styles.stepperLine, n < current && styles.stepperLineDone)} />
            )}
          </div>
        );
      })}
    </div>
  );
}

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
          <div className={styles.fieldError}>
            名称需 2-60 字符
          </div>
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
                onClick={() => setForm((s) => ({ ...s, typeKey: t.key }))}
                className={clsx(styles.typeButton, active && styles.typeButtonActive)}
              >
                <span className={clsx(styles.typeIcon, active && styles.typeIconActive)}>
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

      <div>
        <label className={styles.label}>截止日期（可空）</label>
        <input
          type="date"
          value={form.dueDate}
          onChange={(e) => setForm((s) => ({ ...s, dueDate: e.target.value }))}
          className={clsx(styles.input, !dueValid && styles.inputInvalid)}
        />
        {!dueValid && (
          <div className={styles.fieldError}>
            截止日期不能早于今天
          </div>
        )}
      </div>
    </div>
  );
}

function Step2Classes({
  rows,
  onChange,
}: {
  rows: ClassRow[];
  onChange: (next: ClassRow[]) => void;
}) {
  return (
    <div className={styles.formStack}>
      <div className={styles.sectionHint}>
        添加该项目的标注类别（可空，后续可在项目设置中继续编辑）。每个类别可独立配置颜色和顺序；顺序影响数字键 1-9 / a-z 映射。
      </div>
      <ClassEditor value={rows} onChange={onChange} max={50} emptyHint="暂无类别（后续可在项目设置中添加）" />
    </div>
  );
}

function Step3Attributes({
  fields,
  onChange,
  error,
}: {
  fields: AttributeField[];
  onChange: (next: AttributeField[]) => void;
  error: string | null;
}) {
  return (
    <div className={styles.formStack}>
      <div className={styles.sectionHintTall}>
        为本项目配置标注级业务属性（车型 / 朝向 / 是否遮挡等，可空）。标注员选中标注后，右侧栏将根据 schema 渲染表单；可在项目设置中随时编辑。
      </div>
      <AttributeSchemaEditor
        value={fields}
        onChange={onChange}
        emptyHint="暂无属性（可跳过，后续在项目设置中添加）"
      />
      {error && (
        <div className={styles.schemaError}>{error}</div>
      )}
    </div>
  );
}

function Step4Ai({
  form,
  setForm,
  resolvedAiModel,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  resolvedAiModel: string;
}) {
  return (
    <div className={styles.formStackAi}>
      <label
        className={clsx(styles.aiToggle, form.aiEnabled && styles.aiToggleEnabled)}
      >
        <input
          type="checkbox"
          checked={form.aiEnabled}
          onChange={(e) => setForm((s) => ({ ...s, aiEnabled: e.target.checked }))}
          className={styles.aiCheckbox}
        />
        <Icon name="sparkles" size={14} className={styles.aiIcon} />
        <div className={styles.aiToggleText}>
          <span className={styles.aiToggleTitle}>启用 AI 预标注</span>
          <span className={styles.aiToggleHint}>
            创建后可在项目内挂接真实 ML Backend 推理服务
          </span>
        </div>
      </label>

      {form.aiEnabled && (
        <>
          <div>
            <label className={styles.label}>模型</label>
            <select
              value={form.aiModelChoice}
              onChange={(e) => setForm((s) => ({ ...s, aiModelChoice: e.target.value }))}
              className={clsx(styles.input, styles.selectInput)}
            >
              {PRESET_AI_MODELS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
              <option value={CUSTOM_MODEL_KEY}>自定义...</option>
            </select>
          </div>

          {form.aiModelChoice === CUSTOM_MODEL_KEY && (
            <div>
              <label className={styles.label}>自定义模型名称</label>
              <input
                value={form.aiModelCustom}
                onChange={(e) => setForm((s) => ({ ...s, aiModelCustom: e.target.value }))}
                placeholder="如:MyDet-v1"
                maxLength={120}
                className={styles.input}
              />
            </div>
          )}

          <div className={styles.modelSummary}>
            <span className={styles.modelSummaryLabel}>当前模型:</span>{" "}
            <Badge variant="ai">
              <Icon name="sparkles" size={10} />
              {resolvedAiModel || "—"}
            </Badge>
          </div>

          {/* v0.9.6 · SAM 文本预标默认输出 (与 GeneralSection 4 项一致, 复用共享组件) */}
          <div>
            <label className={styles.label}>
              SAM 文本预标默认输出{" "}
              <span className={styles.labelNote}>
                （工作台「找全图」初始值，可在工作台临时切换）
              </span>
            </label>
            <TextOutputDefaultSelect
              value={form.textOutputDefault}
              onChange={(v) => setForm((s) => ({ ...s, textOutputDefault: v }))}
              className={styles.input}
            />
          </div>

          {/* v0.9.7 · 复用现有 backend dropdown — 让新项目立即可用 AI */}
          <BackendSourceSelect
            value={form.mlBackendSourceId}
            onChange={(v) => setForm((s) => ({ ...s, mlBackendSourceId: v }))}
          />

          <div className={styles.aiHelpBox}>
            模型名仅作 display hint；选「复用 backend」后, 项目创建时会自动复制 backend 配置到新项目, 无需再回设置页注册.
          </div>
        </>
      )}
    </div>
  );
}

/** v0.9.7 · Wizard step 4 复用 backend 下拉. 拉 /admin/ml-integrations/all */
function BackendSourceSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const q = useQuery({
    queryKey: ["admin", "ml-integrations", "all"],
    queryFn: () => adminMlIntegrationsApi.listAll(),
    staleTime: 1000 * 60 * 5,
  });
  const items = q.data?.items ?? [];
  const selected = items.find((b) => b.id === value);

  return (
    <div>
      <label className={styles.label}>
        ML Backend{" "}
        <span className={styles.labelNote}>
          （可选, 复用其它项目已注册的 backend）
        </span>
      </label>
      {q.isLoading ? (
        <div className={clsx(styles.input, styles.readonlyInput)}>
          加载中…
        </div>
      ) : items.length === 0 ? (
        <div className={clsx(styles.input, styles.readonlyInput)}>
          系统内尚无已注册 backend; 项目创建后到设置页注册一个.
        </div>
      ) : (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={clsx(styles.input, styles.selectInput)}
        >
          <option value="">-- 暂不绑定 (创建后到设置页注册) --</option>
          {items.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} ({b.url}) · {b.state} · 来源: {b.source_project_name}
            </option>
          ))}
        </select>
      )}
      {selected && (
        <div className={styles.helpText}>
          将复制 {selected.name} ({selected.url}) 到新项目, 含 auth 配置, state 重置为 disconnected.
        </div>
      )}
    </div>
  );
}

function Step5Datasets({
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
    <div className={styles.formStack}>
      <div className={styles.sectionHint}>
        选择要关联到本项目的数据集（可空 / 多选）。关联后任务会作为「未归类」加入项目；选择下面的「随机切分」可以一并把任务切分到 N 个批次。
      </div>

      {isLoading && <div className={styles.inlineLoading}>加载数据集…</div>}

      {!isLoading && datasets.length === 0 && (
        <div className={styles.emptyPanel}>
          暂无可用数据集，可跳过此步骤稍后在「数据集」页关联。
        </div>
      )}

      {!isLoading && datasets.length > 0 && (
        <div className={styles.datasetList}>
          {datasets.map((d) => {
            const checked = form.datasetIds.includes(d.id);
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => toggle(d.id)}
                className={clsx(styles.choiceButton, checked && styles.choiceButtonChecked)}
              >
                <span className={clsx(styles.checkMark, checked && styles.checkMarkChecked)}>
                  {checked && <Icon name="check" size={10} />}
                </span>
                <span className={styles.choiceBody}>
                  <div className={styles.choiceTitle}>{d.name}</div>
                  <div className={styles.choiceMeta}>
                    <span className="mono">{d.display_id}</span> · {d.file_count} 个文件 · {d.data_type}
                  </div>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {form.datasetIds.length > 0 && (
        <div className={styles.splitPanel}>
          <div className={styles.splitTitle}>
            关联后的初始分包
          </div>
          <div className={styles.splitOptions}>
            <label className={styles.radioLabel}>
              <input
                type="radio"
                checked={form.splitNBatches === 0}
                onChange={() => setForm((s) => ({ ...s, splitNBatches: 0 }))}
              />
              保留默认包（每个数据集一个包）
            </label>
            <label className={styles.radioLabel}>
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
                className={clsx(styles.input, styles.batchCountInput)}
              />
              个批次
            </label>
          </div>
        </div>
      )}

      <div className={styles.stepActions}>
        <Button variant="ghost" onClick={() => onNext(0)} disabled={linking}>跳过</Button>
        <Button variant="primary" onClick={onContinue} disabled={linking}>
          {linking ? "关联中…" : form.datasetIds.length === 0 ? "下一步" : `关联 ${form.datasetIds.length} 个并继续`}
        </Button>
      </div>
    </div>
  );
}

function Step6Members({
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
    <div className={styles.formStack}>
      <div className={styles.sectionHint}>
        选择标注员 / 审核员（可空）。每位成员的角色由其账户角色决定。
      </div>

      {isLoading && <div className={styles.inlineLoading}>加载用户…</div>}

      {!isLoading && eligible.length === 0 && (
        <div className={styles.emptyPanel}>
          暂无 annotator / reviewer 角色的用户，可跳过此步骤。
        </div>
      )}

      {!isLoading && eligible.length > 0 && (
        <div className={styles.memberList}>
          {eligible.map((u) => {
            const checked = form.members.some((m) => m.userId === u.id);
            const role = (u.role === "reviewer" ? "reviewer" : "annotator") as "annotator" | "reviewer";
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => toggle(u.id, role)}
                className={clsx(styles.choiceButton, checked && styles.choiceButtonChecked)}
              >
                <span className={clsx(styles.checkMark, checked && styles.checkMarkChecked)}>
                  {checked && <Icon name="check" size={10} />}
                </span>
                <Avatar initial={(u.name || u.email).slice(0, 1).toUpperCase()} size="sm" />
                <span className={styles.choiceBody}>
                  <div className={styles.choiceTitle}>{u.name || u.email}</div>
                  <div className={styles.choiceMeta}>{u.email}</div>
                </span>
                <Badge variant={role === "reviewer" ? "warning" : "accent"}>
                  {role === "reviewer" ? "审核员" : "标注员"}
                </Badge>
              </button>
            );
          })}
        </div>
      )}

      <div className={styles.stepActions}>
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
  const canOpen = project.type_key === "image-det" || project.type_key === "video-track";
  return (
    <div className={styles.successRoot}>
      <div className={styles.successIcon}>
        <Icon name="check" size={28} />
      </div>
      <div className={styles.successTitle}>{project.name}</div>
      <div className={styles.successMeta}>
        <span className="mono">{project.display_id}</span> · {project.type_label}
      </div>
      <div className={styles.successSummary}>
        已关联 {summary.datasets} 个数据集 · 已添加 {summary.members} 位成员
        {summary.datasets === 0 && (
          <div className={styles.successWarning}>
            尚未关联数据集，可去设置页继续配置
          </div>
        )}
      </div>
      <div className={styles.successActions}>
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
  step: 1 | 2 | 3 | 4;
  canNext: boolean;
  loading: boolean;
  onCancel: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const isFinalEditStep = step === 4;
  return (
    <div className={styles.footer}>
      <Button variant="ghost" onClick={onCancel}>取消</Button>
      {step > 1 && (
        <Button onClick={onPrev}>
          <Icon name="chevLeft" size={12} />上一步
        </Button>
      )}
      <Button variant="primary" onClick={onNext} disabled={!canNext || loading}>
        {isFinalEditStep ? (loading ? "创建中..." : "创建") : "下一步"}
        {!isFinalEditStep && <Icon name="chevRight" size={12} />}
      </Button>
    </div>
  );
}
