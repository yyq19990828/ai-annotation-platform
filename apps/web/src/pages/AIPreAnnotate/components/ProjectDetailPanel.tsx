/**
 * v0.9.12 · BUG B-17 · 项目详情面板 (多选 batch + 串/并行预标 + 已就绪 HistoryTable).
 *
 * 进入条件: ProjectCardGrid 点击某项目卡片;此面板替代主视图渲染.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { VariantSelector } from "@/components/ml/VariantSelector";
import { useToastStore } from "@/components/ui/Toast";
import { useProject } from "@/hooks/useProjects";
import { useBatches } from "@/hooks/useBatches";
import { useBatchEventsSocket } from "@/hooks/useBatchEventsSocket";
import { useMLBackends } from "@/hooks/useMLBackends";
import { useUpdateProject } from "@/hooks/useProjects";
import {
  useTriggerPreannotation,
  type TextOutputMode,
  type PredictMode,
} from "@/hooks/usePreannotation";
import { adminPreannotateApi } from "@/api/adminPreannotate";
import { aliasFrequencyApi } from "@/api/aliasFrequency";
import { mlBackendsApi, type MLModelCapability } from "@/api/ml-backends";
import {
  SchemaForm,
  VARIANT_FIELD_KEYS,
  deriveDefaults,
  type JsonSchemaObject,
} from "@/pages/Workbench/components/SchemaForm";
import { useAiToolParamPrefs } from "@/pages/Workbench/state/useAiToolParamPrefs";
import {
  isVariantHot,
  markVariantHot,
} from "@/pages/Workbench/state/sessionVariantCache";

import { TabRow } from "@/components/ui/TabRow";
import { HistoryTable } from "./HistoryTable";
import { VideoPreannotateGuide } from "./VideoPreannotateGuide";
import { PredictionImportWizard } from "@/components/predictions/PredictionImportWizard";
import { PresetRow } from "./PresetRow";
import { ClassWhitelistRow } from "./ClassWhitelistRow";
import { derivePanelShape } from "../utils/panelShape";
import { useAiParamPresets } from "../utils/useAiParamPresets";
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
// v0.11.24 · 预标幂等模式
const PREDICT_MODE_TABS = ["跳过已预标", "覆盖", "追加"];
const PREDICT_MODE_LABELS: Record<PredictMode, string> = {
  skip_predicted: "跳过已预标",
  overwrite: "覆盖",
  append: "追加",
};
const PREDICT_MODE_BY_LABEL: Record<string, PredictMode> = {
  跳过已预标: "skip_predicted",
  覆盖: "overwrite",
  追加: "append",
};

type ConcurrencyMode = "serial" | "parallel";

// v0.14.9 · 能力声明协议 v2: 文本 / OCR / 文档版面三态任务类型 (按选中 backend 的 models[].task 派生).
// "text" 走原有纯文本 prompt 批量预标; "ocr"/"doc_layout" 走 model_id + task_type 透传.
type PreannotateTaskType = "text" | "ocr" | "doc_layout";
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

// v0.14.17 · YOLO 等"多 task 几何 backend"(闭集, supported_prompts=['none']) 的可选 task.
// 选中后发协议 v2 结构化请求 (task_type + model_id + model_variants), 修通 YOLO 批量预标
// (此前 worker 默认 context.type="text" 被 YOLO 的 Literal 校验 422 拒).
const GEOMETRIC_TASKS = ["detection", "segmentation", "keypoint", "obb"];
const GEOMETRIC_TASK_LABELS: Record<string, string> = {
  detection: "检测（框）",
  segmentation: "分割（掩膜）",
  keypoint: "关键点",
  obb: "朝向框",
};

function cx(...classNames: Array<string | false | null | undefined>) {
  return classNames.filter(Boolean).join(" ");
}

interface Props {
  projectId: string;
  onBack: () => void;
  /** 项目卡片传入的聚合摘要（用于头部 ml_backend chip + 并发上限）；不可省的部分会再用 hooks 拉. */
  summary?: {
    project_name: string;
    project_display_id?: string | null;
    /** v0.10.38 · 媒体维度, 用于按模态分流 (image=文本批量预标 / video=引导卡片). */
    data_type?: string | null;
    ml_backend_id?: string | null;
    ml_backend_name?: string | null;
    ml_backend_state?: string | null;
    ml_backend_max_concurrency?: number | null;
  };
}

export function ProjectDetailPanel({ projectId, onBack, summary }: Props) {
  const pushToast = useToastStore((s) => s.push);
  const navigate = useNavigate();

  // v0.9.13 · 订阅 batch 状态变更, 让"待预标批次"列表实时刷新 (B-15)
  useBatchEventsSocket(projectId);

  const projectQ = useProject(projectId);
  const project = projectQ.data as unknown as
    | {
        type_key?: string;
        data_type?: string | null;
        ml_backend_id?: string | null;
        classes_config?: Record<string, { alias?: string | null }>;
        box_threshold?: number | null;
        text_threshold?: number | null;
        // v0.14.13 · 项目级 variant 偏好 (按 backend_id 分桶), 详见 ProjectOut.default_variants.
        default_variants?: Record<string, Record<string, string>>;
      }
    | undefined;
  // v0.10.38 · 模态分流: summary 优先 (列表已带), 回落 project 查询.
  const dataType = summary?.data_type ?? project?.data_type ?? "image";
  // v0.9.12 · 复活 v0.9.7 alias 频率排序: prompt 默认勾选项目所有 alias (按预标频率降序).
  const freqQ = useQuery({
    queryKey: ["alias-frequency", projectId],
    queryFn: () => aliasFrequencyApi.byProject(projectId),
    enabled: !!projectId,
    staleTime: 1000 * 60 * 5,
  });

  const aliases = useMemo(() => {
    const cfg = project?.classes_config ?? {};
    const freq = freqQ.data?.frequency ?? {};
    return Object.entries(cfg)
      .map(([name, entry]) => ({
        name,
        alias: entry?.alias ?? null,
        count: freq[entry?.alias ?? ""] ?? 0,
      }))
      .filter(
        (e): e is { name: string; alias: string; count: number } => !!e.alias,
      )
      .sort((a, b) => b.count - a.count || a.alias.localeCompare(b.alias));
  }, [project, freqQ.data]);

  const backendsQ = useMLBackends(projectId);
  const backends = (backendsQ.data ?? []) as unknown as Array<{ id: string; name: string }>;
  // v0.10.38 · 多 backend 选择: 默认绑定值, 用户可在项目已注册 backend 间切换 (epic 阶段 2).
  const [selectedBackendId, setSelectedBackendId] = useState<string | null>(null);
  const firstBackendId = backends[0]?.id ?? null;
  useEffect(() => {
    // 项目切换 / 列表加载后, 默认选绑定 backend (否则第一个)
    setSelectedBackendId(project?.ml_backend_id ?? firstBackendId);
  }, [projectId, project?.ml_backend_id, firstBackendId]);
  const selectedBackend =
    backends.find((b) => b.id === selectedBackendId) ?? null;

  // v0.10.38 · 按后端参数面板: 拉选中 backend 的 /setup.params 渲染 SchemaForm,
  // 值按 backend 分桶持久化 (复用工作台 useAiToolParamPrefs), 运行时塞进请求 params.
  const setupQ = useQuery({
    queryKey: ["ml-backends", projectId, selectedBackendId, "setup"],
    queryFn: () => mlBackendsApi.setup(projectId, selectedBackendId as string),
    enabled: !!selectedBackendId,
    staleTime: 60_000,
    retry: false,
  });
  // v0.14.9 · 能力目录 (health_meta 派生): models[] 含 ocr / doc_layout 条目时解锁任务类型选择.
  // 原始 /setup 不一定带 models[], 故单独走 capabilities 端点.
  const capabilitiesQ = useQuery({
    queryKey: ["ml-backends", projectId, selectedBackendId, "capabilities"],
    queryFn: () => mlBackendsApi.capabilities(projectId, selectedBackendId as string),
    enabled: !!selectedBackendId,
    staleTime: 60_000,
    retry: false,
  });
  // 选中 backend 暴露的 ocr / doc_layout 模型条目 (按 task 去重取首个).
  const ocrModel = useMemo<MLModelCapability | undefined>(
    () => (capabilitiesQ.data?.models ?? []).find((m) => m.task === "ocr"),
    [capabilitiesQ.data],
  );
  const docLayoutModel = useMemo<MLModelCapability | undefined>(
    () => (capabilitiesQ.data?.models ?? []).find((m) => m.task === "doc_layout"),
    [capabilitiesQ.data],
  );
  const availableTaskTypes = useMemo<PreannotateTaskType[]>(() => {
    const types: PreannotateTaskType[] = ["text"];
    if (ocrModel) types.push("ocr");
    if (docLayoutModel) types.push("doc_layout");
    return types;
  }, [ocrModel, docLayoutModel]);
  const hasDocTasks = availableTaskTypes.length > 1;

  const [taskType, setTaskType] = useState<PreannotateTaskType>("text");
  // 切 backend / 能力目录刷新后, 若当前任务类型不再可用则回落 text.
  useEffect(() => {
    if (!availableTaskTypes.includes(taskType)) setTaskType("text");
  }, [availableTaskTypes, taskType]);
  const activeDocModel = taskType === "ocr" ? ocrModel : taskType === "doc_layout" ? docLayoutModel : undefined;
  const isDocMode = taskType === "ocr" || taskType === "doc_layout";

  // v0.14.13 · 选中 backend 的 "主" model: doc 模式用 OCR / layout 条目;
  // 否则取 capabilities 里第一个非 doc 模型 (yolo 4 个 model 共用 default_variants, 任取第一即可;
  // gsam2 / sam3 多 task 共享 supported_variants 时同样).
  // 主 model 提供 default_variants / variant_combinations / supported_variants 给 VariantSelector.
  const primaryModel = useMemo<MLModelCapability | undefined>(() => {
    if (isDocMode) return activeDocModel;
    const models = capabilitiesQ.data?.models ?? [];
    return (
      models.find((m) => m.task !== "ocr" && m.task !== "doc_layout") ?? models[0]
    );
  }, [isDocMode, activeDocModel, capabilitiesQ.data]);

  // v0.14.16 · capability 驱动面板变形: 由当前 model 派生"输出形态是否显示 / prompt 区形态".
  // YOLO 闭集 (supported_prompts=['none'], 单一几何) → 隐藏输出形态三选 + 文本框降级为类别筛选.
  const panelShape = useMemo(
    () => derivePanelShape(primaryModel, isDocMode),
    [primaryModel, isDocMode],
  );

  // v0.14.17 · 闭集多 task 几何 backend (YOLO): 暴露 detection/seg/keypoint/obb 多 model 且无 text prompt.
  // 提供显式 task 选择器, 选中 task → 发 v2 结构化请求修通 YOLO 批量预标.
  const geometricModels = useMemo<MLModelCapability[]>(
    () =>
      (capabilitiesQ.data?.models ?? []).filter((m) =>
        GEOMETRIC_TASKS.includes(m.task ?? ""),
      ),
    [capabilitiesQ.data],
  );
  const isGeometricBackend =
    !isDocMode &&
    geometricModels.length > 0 &&
    !(primaryModel?.supported_prompts ?? []).includes("text");
  const [geometricTaskId, setGeometricTaskId] = useState<string | null>(null);
  useEffect(() => {
    setGeometricTaskId(geometricModels[0]?.id ?? null);
  }, [selectedBackendId, geometricModels]);
  const geometricModel =
    geometricModels.find((m) => m.id === geometricTaskId) ?? geometricModels[0];
  // v0.14.17 · 类别白名单: 选中的模型原生类别 index 子集 (空集=检出全部类别). 随 task 切换重置.
  // classes 仅在该 task 模型已加载过 (warmup/predict) 才有值; 未就位时不显示勾选, 默认全部.
  const [selectedClassIdx, setSelectedClassIdx] = useState<Set<number>>(new Set());
  useEffect(() => {
    setSelectedClassIdx(new Set());
  }, [selectedBackendId, geometricTaskId]);

  // v0.14.17 · 手动预热: 想按类别筛选的用户点一下加载该 task 的类别表 (model.names);
  // 不需筛选 (默认全标) 的用户无需预热。预热后 backend 失效 /setup 缓存, 刷新 capabilities 即出类别。
  const qc = useQueryClient();
  const warmMut = useMutation({
    mutationFn: () => {
      const variants: Record<string, string> = {};
      for (const k of variantAxisKeysRef.current) {
        const v = paramsValue[k];
        if (typeof v === "string") variants[k] = v;
      }
      return mlBackendsApi.warmup(projectId, selectedBackendId as string, {
        task: geometricModel?.task,
        variants,
      });
    },
    onSuccess: () => {
      pushToast({ msg: "已预热，正在加载类别…", kind: "success" });
      qc.invalidateQueries({
        queryKey: ["ml-backends", projectId, selectedBackendId, "capabilities"],
      });
      qc.invalidateQueries({
        queryKey: ["ml-backends", projectId, selectedBackendId, "setup"],
      });
    },
    onError: (err) =>
      pushToast({ msg: "预热失败", sub: (err as Error)?.message, kind: "error" }),
  });

  // 文本任务用 /setup.params; OCR / 版面用所选 model 条目自带的 params schema.
  const paramsSchema = (
    isDocMode ? activeDocModel?.params : setupQ.data?.params
  ) as JsonSchemaObject | undefined;
  const paramKeys = Object.keys(paramsSchema?.properties ?? {});
  const hasAnyParams = paramKeys.length > 0;
  const hasNonVariantParams = paramKeys.some(
    (key) => !VARIANT_FIELD_KEYS.includes(key as (typeof VARIANT_FIELD_KEYS)[number]),
  );
  const { savedParams, save: saveParams } = useAiToolParamPrefs(selectedBackendId);
  const [paramsValue, setParamsValue] = useState<Record<string, unknown>>({});

  // v0.14.13 · 项目级 variant 偏好 merge backend 自报默认, 得到 VariantSelector 的 defaults.
  // 优先级 (高 → 低): project.default_variants[backend_id] > primaryModel.default_variants.
  const variantDefaults = useMemo<Record<string, string>>(() => {
    const fromBackend = primaryModel?.default_variants ?? {};
    const fromProject = (selectedBackendId
      ? project?.default_variants?.[selectedBackendId]
      : undefined) ?? {};
    return { ...fromBackend, ...fromProject };
  }, [primaryModel, project?.default_variants, selectedBackendId]);

  // 选中 backend / schema / 偏好就绪时, 用 偏好 → schema 默认 → variantDefaults 重建参数值.
  // variantDefaults 在 saved 之上叠加, 让 axis_key 即便 saved 没存也有初值给 VariantSelector 渲染.
  useEffect(() => {
    if (!selectedBackendId) return;
    setParamsValue({
      ...deriveDefaults(paramsSchema),
      ...variantDefaults,
      ...(savedParams ?? {}),
    });
  }, [selectedBackendId, paramsSchema, savedParams, variantDefaults]);

  const onParamsChange = (next: Record<string, unknown>) => {
    setParamsValue(next);
    saveParams(next);
  };

  // v0.14.13 · variant 写回项目级偏好 (debounced 跟随 PATCH).
  // axis_key 来自 primaryModel.supported_variants[].key; 其它非 variant key 落 localStorage (saveParams).
  const updateProjectMu = useUpdateProject(projectId);
  const variantAxisKeysRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    variantAxisKeysRef.current = new Set(
      (primaryModel?.supported_variants ?? [])
        .map((g) => g.key)
        .filter((k): k is string => typeof k === "string"),
    );
  }, [primaryModel]);

  const onVariantOrParamsChange = (next: Record<string, unknown>) => {
    setParamsValue(next);
    saveParams(next);
    if (!selectedBackendId) return;
    const axisKeys = variantAxisKeysRef.current;
    if (axisKeys.size === 0) return;
    const variantSlice: Record<string, string> = {};
    for (const k of axisKeys) {
      const v = next[k];
      if (typeof v === "string") variantSlice[k] = v;
    }
    // 与项目当前偏好对比, 有变化才 PATCH (避免每次 paramsValue 变都打 API).
    const currentProjectSlice = project?.default_variants?.[selectedBackendId] ?? {};
    const same =
      Object.keys(variantSlice).length === Object.keys(currentProjectSlice).length &&
      Object.entries(variantSlice).every(([k, v]) => currentProjectSlice[k] === v);
    if (same) return;
    const merged: Record<string, Record<string, string>> = {
      ...(project?.default_variants ?? {}),
      [selectedBackendId]: variantSlice,
    };
    updateProjectMu.mutate({ default_variants: merged });
  };

  // v0.14.16 · 命名预设 (variant + params 快照, localStorage 按 backend×task 分桶).
  const { presets, save: savePreset, remove: removePreset } = useAiParamPresets(
    selectedBackendId,
    taskType,
  );
  // 套用预设走 onVariantOrParamsChange: 同时 setParamsValue + 持久化 + variant 写回项目偏好.
  const applyPreset = (values: Record<string, unknown>) => {
    onVariantOrParamsChange({ ...deriveDefaults(paramsSchema), ...variantDefaults, ...values });
  };

  const batchesQ = useBatches(projectId, "active");
  const batches = (batchesQ.data ?? []) as unknown as Array<{
    id: string;
    display_id: string;
    name: string;
    total_tasks?: number | null;
  }>;

  // pre_annotated 队列 (复用 /admin/preannotate-queue 端点 + 客户端按 project 过滤)
  const queueQ = useQuery({
    queryKey: ["admin", "preannotate-queue"],
    queryFn: () => adminPreannotateApi.queue(50),
    staleTime: 1000 * 30,
  });
  const projectQueue = useMemo(
    () => (queueQ.data?.items ?? []).filter((it) => it.project_id === projectId),
    [queueQ.data, projectId],
  );

  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<string>>(new Set());
  const [prompt, setPrompt] = useState("");
  const [outputMode, setOutputMode] = useState<TextOutputMode>("mask");
  // v0.11.24 · 默认跳过已预标 task，避免重复预标叠加重复标注
  const [predictMode, setPredictMode] = useState<PredictMode>("skip_predicted");
  const [concurrency, setConcurrency] = useState<ConcurrencyMode>("serial");
  const [running, setRunning] = useState(false);
  // v0.10.15 · 外部预测导入向导 (COCO / AAP JSON)
  const [importOpen, setImportOpen] = useState(false);

  // v0.9.13 · prompt token 集合 (逗号分隔 → 去空小写), 用于 chip active 态判定
  const promptTokenSet = useMemo(() => {
    const tokens = prompt
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    return new Set(tokens);
  }, [prompt]);

  const toggleAlias = (alias: string) => {
    const a = alias.trim();
    if (!a) return;
    const aLower = a.toLowerCase();
    if (promptTokenSet.has(aLower)) {
      const next = prompt
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t && t.toLowerCase() !== aLower)
        .join(", ");
      setPrompt(next);
    } else {
      const trimmed = prompt.trim().replace(/,\s*$/, "");
      setPrompt(trimmed ? `${trimmed}, ${a}` : a);
    }
  };

  // 项目切换时重置选择 / 默认 outputMode / prompt
  useEffect(() => {
    setSelectedBatchIds(new Set());
    // v0.10.28 · 遗留技术债: AI 输出形态分流仍按 type_key (image-det → box, 其余 mask).
    // data_type 只到媒体粒度, 无法区分检测 vs 分割; 后续应改读 tool_bindings 是否启用
    // region. 本次 data_type 迁移不动此处, 保持原 AI 分流行为.
    setOutputMode(
      project?.type_key === "image-det" ? "box" : "mask",
    );
    setPrompt("");
    defaultPromptAppliedRef.current = "";
  }, [projectId, project?.type_key]);

  // v0.9.12 · 复活 v0.9.7 行为: aliases 加载完且 prompt 仍空时, 默认勾选所有 alias 拼成逗号分隔
  // (按预标频率降序, 频率为 0 时按 alias 字母升序). 已手填则不覆盖. 切项目时上一段 effect 会先
  // 清 prompt + 复位 ref. 等 freqQ.isFetched 而非仅 aliases.length, 否则首屏 freq=undefined 时
  // alpha 序填进去后, freqQ 解析也不会再重排.
  const defaultPromptAppliedRef = useRef<string>("");
  useEffect(() => {
    if (!projectId) return;
    if (defaultPromptAppliedRef.current === projectId) return;
    if (!freqQ.isFetched) return;
    if (aliases.length === 0) return;
    if (prompt.trim()) {
      defaultPromptAppliedRef.current = projectId;
      return;
    }
    setPrompt(aliases.map((a) => a.alias).join(", "));
    defaultPromptAppliedRef.current = projectId;
  }, [projectId, aliases, prompt, freqQ.isFetched]);

  const trigger = useTriggerPreannotation(projectId);

  const toggleBatch = (id: string) => {
    setSelectedBatchIds((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const allSelected = batches.length > 0 && batches.every((b) => selectedBatchIds.has(b.id));
  const toggleAll = () => {
    setSelectedBatchIds((s) => {
      const n = new Set(s);
      if (allSelected) {
        for (const b of batches) n.delete(b.id);
      } else {
        for (const b of batches) n.add(b.id);
      }
      return n;
    });
  };

  // OCR / 版面 (isDocMode) 与 YOLO 几何 backend (isGeometricBackend) 无需文本 prompt;
  // 纯文本 (gsam2) 仍要求非空 prompt.
  const canRun =
    !!selectedBackend &&
    selectedBatchIds.size > 0 &&
    (isDocMode || isGeometricBackend || !!prompt.trim()) &&
    !running;

  const onRun = async () => {
    if (!selectedBackend || selectedBatchIds.size === 0) return;
    if (!isDocMode && !isGeometricBackend && !prompt.trim()) return;
    const ids = Array.from(selectedBatchIds);
    // 输出形态被隐藏 (model 单一几何输出) 时下发强制形态, 否则用用户所选.
    const effectiveOutputMode = panelShape.forcedOutputMode ?? outputMode;
    // v0.14.17 · 几何 backend 走 v2 结构化: paramsValue 拆成 model_variants (variant 轴) + params (其余).
    const variantSlice: Record<string, string> = {};
    const nonVariantParams: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(paramsValue)) {
      if (variantAxisKeysRef.current.has(k)) {
        if (typeof v === "string") variantSlice[k] = v;
      } else {
        nonVariantParams[k] = v;
      }
    }
    const baseArgs = isGeometricBackend
      ? {
          ml_backend_id: selectedBackend.id,
          task_type: geometricModel?.task,
          model_id: geometricModel?.id,
          model_variants: variantSlice,
          params: nonVariantParams,
          predict_mode: predictMode,
          // 类别白名单: 空集 = 全部类别 (不下发 class_filter).
          ...(selectedClassIdx.size > 0
            ? { class_filter: Array.from(selectedClassIdx).sort((a, b) => a - b) }
            : {}),
        }
      : isDocMode
        ? {
            ml_backend_id: selectedBackend.id,
            model_id: activeDocModel?.id,
            task_type: taskType,
            params: paramsValue,
            predict_mode: predictMode,
          }
        : {
            ml_backend_id: selectedBackend.id,
            prompt: prompt.trim(),
            output_mode: effectiveOutputMode,
            params: paramsValue,
            predict_mode: predictMode,
          };
    setRunning(true);
    try {
      let okCount = 0;
      let failCount = 0;
      const errors: string[] = [];
      // v0.14.13 · 冷启动 UX 本地猜测: 第一次发起的 variant 组合在响应回来后入 warm 集合.
      // 即便 backend 内部并未真的命中 cache (本批可能 4 张图分散到不同 size 子串路径),
      // 后续按钮文案直接走"热"路径; 等 v0.14.14 后端 cache_hit 真信号替换.
      const fireOne = async (bid: string) => {
        try {
          await trigger.mutateAsync({ ...baseArgs, batch_id: bid });
          okCount += 1;
        } catch (err) {
          failCount += 1;
          errors.push(`${bid.slice(0, 8)}: ${(err as Error).message}`);
        }
      };
      if (concurrency === "serial") {
        for (const bid of ids) {
          await fireOne(bid);
        }
      } else {
        await Promise.all(ids.map(fireOne));
      }
      pushToast({
        msg: `${concurrency === "serial" ? "串行" : "并行"} 预标已分发`,
        sub: `${okCount} 成功 · ${failCount} 失败`,
        kind: failCount > 0 ? "warning" : "success",
      });
      if (failCount > 0 && errors.length > 0) {
        console.warn("[ai-pre] 多批次预标部分失败:", errors);
      }
      if (okCount > 0) {
        setSelectedBatchIds(new Set());
        // v0.14.13 · 至少一批成功 → 记 variant 已热. 异步 trigger 拿不到 cache_hit,
        // 走兜底语义 (推理成功 ⇒ backend 完成时 pool 中有此 variant).
        if (selectedBackendId) {
          const variantSlice: Record<string, string> = {};
          for (const k of variantAxisKeysRef.current) {
            const v = paramsValue[k];
            if (typeof v === "string") variantSlice[k] = v;
          }
          if (Object.keys(variantSlice).length > 0) {
            markVariantHot(selectedBackendId, variantSlice);
          }
        }
      }
    } finally {
      setRunning(false);
    }
  };

  // v0.14.13 · 当前 variant 选择是否已 warm (用于按钮文案分两态).
  const currentVariantSlice = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const k of variantAxisKeysRef.current) {
      const v = paramsValue[k];
      if (typeof v === "string") out[k] = v;
    }
    return out;
  }, [paramsValue, primaryModel]);
  // v0.14.14: 统一查 isVariantHot (单一 hot map, 多源写入 — markVariantHot 兜底 +
  // recordPredictCacheHit 真信号). running 变化让 useMemo 在响应回来后重算.
  const isCurrentVariantWarm = useMemo(() => {
    if (!selectedBackendId) return false;
    return isVariantHot(selectedBackendId, currentVariantSlice);
  }, [selectedBackendId, currentVariantSlice, running]);

  const headerName = summary?.project_name ?? `项目 ${projectId.slice(0, 8)}`;

  // v0.10.38 · 模态分流: 视频项目无批量文本预标语义 (AI 预标在工作台逐轨迹 Shift+T 发起),
  // 渲染引导卡片 + job 历史链接, 不误用图像批量面板 (epic 阶段 2).
  if (dataType === "video") {
    return (
      <VideoPreannotateGuide
        projectId={projectId}
        projectName={headerName}
        displayId={summary?.project_display_id}
        onBack={onBack}
      />
    );
  }
  if (dataType === "lidar") {
    return (
      <div className={styles.root}>
        <div className={styles.header}>
          <Button size="sm" variant="ghost" onClick={onBack}>
            <Icon name="chevLeft" size={11} /> 返回项目列表
          </Button>
          <h2 className={styles.title}>{headerName}</h2>
        </div>
        <Card>
          <div className={styles.mutedText}>点云（lidar）项目暂不支持 AI 预标。</div>
        </Card>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <Button size="sm" variant="ghost" onClick={onBack}>
          <Icon name="chevLeft" size={11} /> 返回项目列表
        </Button>
        <h2 className={styles.title}>{headerName}</h2>
        {summary?.project_display_id && (
          <span className={styles.displayId}>
            ({summary.project_display_id})
          </span>
        )}
        {selectedBackend ? (
          <Badge variant="ai">{selectedBackend.name}</Badge>
        ) : (
          <Badge variant="warning">未绑定 ML backend</Badge>
        )}
        {summary?.ml_backend_max_concurrency != null && (
          <span className={styles.backendLimit}>
            最多 {summary.ml_backend_max_concurrency} 并发
          </span>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => navigate(`/ai-pre/jobs?project_id=${projectId}`)}
          title="该项目所有 prediction job 历史"
        >
          <Icon name="history" size={11} /> 历史 job
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setImportOpen(true)}
          title="上传 COCO / AAP JSON 把外部模型预测灌进本项目"
        >
          <Icon name="upload" size={11} /> 导入预测
        </Button>
      </div>

      <PredictionImportWizard
        open={importOpen}
        onClose={() => setImportOpen(false)}
        projectId={projectId}
      />

      <Card>
        <div className={styles.cardHeader}>
          <strong className={styles.sectionTitle}>待预标批次（{batches.length}）</strong>
          {batches.length > 0 && (
            <label className={styles.inlineCheckbox}>
              <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="全选 active" />
              全选
            </label>
          )}
        </div>
        <div className={styles.cardBodyCompact}>
          {batchesQ.isLoading ? (
            <div className={styles.mutedText}>加载中…</div>
          ) : batches.length === 0 ? (
            <div className={styles.mutedText}>
              暂无 active 批次。在项目设置中创建批次后再回到这里跑预标。
            </div>
          ) : (
            <ul className={styles.batchList}>
              {batches.map((b) => (
                <li
                  key={b.id}
                  className={cx(styles.batchItem, selectedBatchIds.has(b.id) && styles.batchItemSelected)}
                  onClick={() => toggleBatch(b.id)}
                >
                  <input
                    type="checkbox"
                    aria-label={`选择 ${b.name}`}
                    checked={selectedBatchIds.has(b.id)}
                    onChange={() => toggleBatch(b.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className={styles.batchName}>
                    {b.name}{" "}
                    <span className={styles.subtleText}>({b.display_id})</span>
                  </span>
                  <span className={styles.taskCount}>
                    {b.total_tasks ?? "—"} 任务
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {/* v0.14.16 · 配置区常驻: 不再被 selectedBatchIds gate, 未选批次也可预先配置 / 存预设,
          仅"运行"按钮禁用 (见 canRun). */}
      <Card>
        <div className={styles.runPanel}>
          <strong className={styles.sectionTitle}>
            {selectedBatchIds.size > 0
              ? `对已选 ${selectedBatchIds.size} 批跑预标`
              : "批跑预标设置"}
          </strong>

            {/* v0.14.9 · 能力声明协议 v2: backend 暴露 ocr / doc_layout 模型时, 提供任务类型选择.
                选 OCR / 文档版面后隐藏纯文本 prompt 控件, 请求带 model_id + task_type. */}
            {hasDocTasks && (
              <div className={styles.field}>
                <span className={styles.fieldLabel}>任务类型</span>
                <TabRow
                  tabs={availableTaskTypes.map((t) => TASK_TYPE_LABELS[t])}
                  active={TASK_TYPE_LABELS[taskType]}
                  onChange={(label) => {
                    const t = TASK_TYPE_BY_LABEL[label];
                    if (t) setTaskType(t);
                  }}
                />
              </div>
            )}

            {/* v0.14.17 · 闭集多 task 几何 backend (YOLO): 显式选 task → 发 v2 结构化请求.
                选 task 即决定输出几何 (检测=框 / 分割=掩膜), 故此类 backend 不另设输出形态/prompt. */}
            {isGeometricBackend && geometricModels.length > 1 && (
              <div className={styles.field}>
                <span className={styles.fieldLabel}>模型任务</span>
                <TabRow
                  tabs={geometricModels.map(
                    (m) => GEOMETRIC_TASK_LABELS[m.task ?? ""] ?? m.task ?? m.id,
                  )}
                  active={
                    geometricModel
                      ? GEOMETRIC_TASK_LABELS[geometricModel.task ?? ""] ??
                        geometricModel.task ??
                        geometricModel.id
                      : ""
                  }
                  onChange={(label) => {
                    const m = geometricModels.find(
                      (x) =>
                        (GEOMETRIC_TASK_LABELS[x.task ?? ""] ?? x.task ?? x.id) ===
                        label,
                    );
                    if (m) setGeometricTaskId(m.id);
                  }}
                />
              </div>
            )}

            {/* v0.14.17 · YOLO 类别白名单勾选 ([index]类名). 留空=全部. 结果渲染模型原生类名,
                采纳时由人选项目标签 (NG6: 平台不做映射). */}
            {isGeometricBackend && (
              <ClassWhitelistRow
                classes={geometricModel?.classes}
                selected={selectedClassIdx}
                onChange={setSelectedClassIdx}
                onWarm={() => warmMut.mutate()}
                warming={warmMut.isPending}
              />
            )}

            {/* v0.14.9 · OCR / 版面识别静态提示: 识别文本写入 annotation 属性, 项目需配置 text 属性. */}
            {isDocMode && (
              <div className={cx(styles.field, styles.docHint)}>
                <Icon name="info" size={12} />
                <span>
                  {taskType === "ocr" ? "OCR 文字识别" : "文档版面"}
                  ：识别文本将写入 annotation 属性；若项目未配置 text 属性，文本不会入库。
                </span>
              </div>
            )}

            {/* prompt 区: 开放词表文本任务 (gsam2) 显示; OCR/版面 (isDocMode) 与 YOLO 几何 backend
                (isGeometricBackend, 走 task 选择器 + v2 请求, 后端忽略 prompt) 隐藏.
                结构化"类别白名单" + 后端过滤是 v0.14.17 后续项. */}
            {!isDocMode && !isGeometricBackend && (
              <label className={styles.field}>
                <span className={styles.fieldLabel}>
                  Prompt（同一段文本应用到所有选中批次；逗号分隔）
                </span>
                {/* v0.9.13 · alias chips: 点击 toggle prompt 添加 / 移除. 频率排序见 aliases useMemo. */}
                {aliases.length > 0 && (
                  <div className={styles.aliasList}>
                    {aliases.map((a) => {
                      const isActive = promptTokenSet.has(a.alias.toLowerCase());
                      return (
                        <button
                          key={a.name}
                          type="button"
                          onClick={() => toggleAlias(a.alias)}
                          className={cx(styles.aliasChip, isActive && styles.aliasChipActive)}
                          title={`${isActive ? "移除" : "添加"} 类别「${a.name}」的 alias${a.count > 0 ? ` · 历史 ${a.count} 次` : ""}`}
                        >
                          <span>{isActive ? "✓ " : ""}{a.alias}</span>
                          <span className={styles.aliasName}>
                            ({a.name})
                          </span>
                          {a.count > 0 && (
                            <span className={styles.aliasCount}>
                              ×{a.count}
                            </span>
                          )}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => setPrompt(aliases.map((x) => x.alias).join(", "))}
                      className={styles.refillButton}
                      title="一键重填: 按频率拼上所有 alias"
                    >
                      重填
                    </button>
                  </div>
                )}
                <textarea
                  rows={2}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="例：car, person, traffic light"
                  className={styles.promptInput}
                />
              </label>
            )}

            {/* v0.10.38 · 多 backend 选择: 在项目已注册 backend 间选, 默认绑定值 (epic 阶段 2) */}
            {backends.length > 1 && (
              <label className={styles.field}>
                <span className={styles.fieldLabel}>ML Backend</span>
                <select
                  value={selectedBackendId ?? ""}
                  onChange={(e) => setSelectedBackendId(e.target.value || null)}
                  className={styles.promptInput}
                >
                  {backends.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                      {b.id === project?.ml_backend_id ? "（绑定）" : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {/* v0.10.38 · 按后端参数面板: 复用 SchemaForm 按选中 backend 的 /setup.params 渲染.
                gsam2 即 box/text_threshold; 值按 backend 记忆 (params_by_backend), 运行时随请求覆盖
                项目级阈值兜底. 取代旧的项目级 ThresholdRow (项目默认仍可在项目设置 GeneralSection 改). */}
            <div className={styles.field}>
              <span className={styles.fieldLabel}>
                后端推理参数（按 backend 记忆，覆盖项目默认）
              </span>
              {/* 文本任务: /setup.params; OCR / 版面: 所选 model 条目自带 params (见 paramsSchema 派生). */}
              {!isDocMode && setupQ.isLoading ? (
                <div className={styles.mutedText}>加载参数…</div>
              ) : !isDocMode && setupQ.isError ? (
                <div className={styles.mutedText}>
                  无法拉取 backend /setup，运行时回落项目级阈值。
                </div>
              ) : isDocMode && !hasAnyParams ? (
                <div className={styles.mutedText}>该任务无可调参数。</div>
              ) : (
                <div className={styles.backendParamsStack}>
                  <VariantSelector
                    schema={paramsSchema}
                    // v0.14.13 · 取 model 级 supported_variants (yolo 4 task 各自轴; gsam2
                    // detection/seg/iseg/tracker 按 task 暴露相应轴), 不再用 backend 顶层并集.
                    supportedVariants={
                      primaryModel?.supported_variants ??
                      (isDocMode
                        ? activeDocModel?.supported_variants
                        : setupQ.data?.supported_variants)
                    }
                    variantCombinations={primaryModel?.variant_combinations}
                    defaults={variantDefaults}
                    value={paramsValue}
                    onChange={onVariantOrParamsChange}
                  />
                  {(hasNonVariantParams || !hasAnyParams) && (
                    <SchemaForm
                      schema={paramsSchema}
                      value={paramsValue}
                      onChange={onParamsChange}
                    />
                  )}
                </div>
              )}
            </div>

            {/* v0.14.16 · 命名预设 (variant + params 快照, 按 backend×task 分桶 localStorage). */}
            <PresetRow
              presets={presets}
              disabled={!selectedBackendId}
              onApply={(p) => applyPreset(p.values)}
              onSave={(name) => savePreset(name, paramsValue)}
              onRemove={removePreset}
            />

            {/* v0.14.16 · 输出形态: 仅当 model 同时支持框与掩膜时显示 (单一几何/keypoint 隐藏, 见 panelShape). */}
            {panelShape.showOutputMode && (
              <div className={styles.field}>
                <span className={styles.fieldLabel}>输出形态</span>
                <TabRow
                  tabs={OUTPUT_MODE_TABS}
                  active={OUTPUT_MODE_LABELS[outputMode]}
                  onChange={(label) => {
                    const m = OUTPUT_MODE_BY_LABEL[label];
                    if (m) setOutputMode(m);
                  }}
                />
              </div>
            )}

            <div className={styles.field}>
              <span className={styles.fieldLabel}>
                已预标任务
                {predictMode === "overwrite" && (
                  <span className={styles.fieldHint}> · 覆盖会删除已有 AI 标注</span>
                )}
              </span>
              <TabRow
                tabs={PREDICT_MODE_TABS}
                active={PREDICT_MODE_LABELS[predictMode]}
                onChange={(label) => {
                  const m = PREDICT_MODE_BY_LABEL[label];
                  if (m) setPredictMode(m);
                }}
              />
            </div>

            {selectedBatchIds.size > 1 && (
              <div role="radiogroup" aria-label="并发模式" className={styles.concurrencyGroup}>
                <label className={styles.radioLabel}>
                  <input
                    type="radio"
                    name="concurrency"
                    checked={concurrency === "serial"}
                    onChange={() => setConcurrency("serial")}
                  />
                  串行（依次入队）
                </label>
                <label className={styles.radioLabel}>
                  <input
                    type="radio"
                    name="concurrency"
                    checked={concurrency === "parallel"}
                    onChange={() => setConcurrency("parallel")}
                  />
                  并行（同时入队）
                </label>
                {summary?.ml_backend_max_concurrency != null && (
                  <span className={styles.mutedInline}>
                    （后端最多 {summary.ml_backend_max_concurrency} 并发）
                  </span>
                )}
              </div>
            )}

            <div className={styles.actions}>
              <Button
                onClick={onRun}
                disabled={!canRun}
                title={
                  selectedBatchIds.size === 0
                    ? "请先选择至少一个批次"
                    : undefined
                }
              >
                <Icon name="bot" size={12} />
                {running
                  ? isCurrentVariantWarm
                    ? "分发中..."
                    : "加载模型中…（首次约 5-15s）"
                  : selectedBatchIds.size === 0
                    ? "跑预标（先选批次）"
                    : `跑预标（${selectedBatchIds.size} 批）`}
              </Button>
            </div>
          </div>
      </Card>

      <HistoryTable items={projectQueue} isLoading={queueQ.isLoading} />
    </div>
  );
}
