/**
 * 预标"配置区"共享状态 hook.
 *
 * 把 ProjectDetailPanel 的批跑配置逻辑 (任务类型 / 几何 task / 类别白名单 / variant / 参数 /
 * prompt / 预设 / 输出形态 + buildArgs) 抽成自包含 hook, 供批量页与工作台 AI 面板共用 (单一事实源)。
 * 批量专属的 backend 多选 / predict_mode / 并发 / 批次选择 / run 编排仍由调用方持有。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { useToastStore } from "@/components/ui/Toast";
import { useProject, useUpdateProject } from "@/hooks/useProjects";
import { type TextOutputMode, type PredictMode } from "@/hooks/usePreannotation";
import { aliasFrequencyApi } from "@/api/aliasFrequency";
import {
  mlBackendsApi,
  type MLModelCapability,
} from "@/api/ml-backends";
import {
  VARIANT_FIELD_KEYS,
  deriveDefaults,
  type JsonSchemaObject,
} from "@/pages/Workbench/components/SchemaForm";
import { useAiToolParamPrefs } from "@/pages/Workbench/state/useAiToolParamPrefs";
import { isVariantHot, markVariantHot } from "@/pages/Workbench/state/sessionVariantCache";
import {
  derivePanelShape,
  deriveTextPanelShape,
  deriveVariantSource,
  type VariantSource,
} from "../utils/panelShape";
import { useAiParamPresets } from "../utils/useAiParamPresets";

// v0.14.9 · 文本 / OCR / 文档版面三态任务类型 (按选中 backend 的 models[].task 派生).
export type PreannotateTaskType = "text" | "ocr" | "doc_layout";

// v0.14.17 · YOLO 等"多 task 几何 backend"(闭集, supported_prompts=['none']) 的可选 task.
export const GEOMETRIC_TASKS = ["detection", "segmentation", "keypoint", "obb"];

export interface PreannotateAlias {
  name: string;
  alias: string;
  count: number;
}

/** buildArgs 产出的单次请求字段袋 (不含 task_ids / batch_id, 由调用方补). */
export interface PreannotateArgs {
  ml_backend_id: string;
  task_type?: string;
  model_id?: string;
  model_variants?: Record<string, string>;
  prompt?: string;
  output_mode?: TextOutputMode;
  params: Record<string, unknown>;
  predict_mode: PredictMode;
  class_filter?: number[];
}

export interface UsePreannotateConfigArgs {
  projectId: string;
  /** 当前选中的 backend id (批量页可多选; 工作台为项目绑定值). null 时多数派生为空/禁用. */
  backendId: string | null;
}

export function usePreannotateConfig({ projectId, backendId }: UsePreannotateConfigArgs) {
  const pushToast = useToastStore((s) => s.push);
  const qc = useQueryClient();

  const projectQ = useProject(projectId);
  const project = projectQ.data as unknown as
    | {
        type_key?: string;
        classes_config?: Record<string, { alias?: string | null }>;
        default_variants?: Record<string, Record<string, string>>;
      }
    | undefined;

  // v0.9.12 · alias 频率排序: prompt 默认勾选项目所有 alias (按预标频率降序).
  const freqQ = useQuery({
    queryKey: ["alias-frequency", projectId],
    queryFn: () => aliasFrequencyApi.byProject(projectId),
    enabled: !!projectId,
    staleTime: 1000 * 60 * 5,
  });
  const aliases = useMemo<PreannotateAlias[]>(() => {
    const cfg = project?.classes_config ?? {};
    const freq = freqQ.data?.frequency ?? {};
    return Object.entries(cfg)
      .map(([name, entry]) => ({
        name,
        alias: entry?.alias ?? null,
        count: freq[entry?.alias ?? ""] ?? 0,
      }))
      .filter((e): e is PreannotateAlias => !!e.alias)
      .sort((a, b) => b.count - a.count || a.alias.localeCompare(b.alias));
  }, [project, freqQ.data]);

  // v0.10.38 · 按后端参数面板: 拉选中 backend 的 /setup.params 渲染 SchemaForm.
  const setupQ = useQuery({
    queryKey: ["ml-backends", projectId, backendId, "setup"],
    queryFn: () => mlBackendsApi.setup(projectId, backendId as string),
    enabled: !!backendId,
    staleTime: 60_000,
    retry: false,
  });
  // v0.14.9 · 能力目录 (health_meta 派生): models[] 含 ocr / doc_layout / 几何条目.
  const capabilitiesQ = useQuery({
    queryKey: ["ml-backends", projectId, backendId, "capabilities"],
    queryFn: () => mlBackendsApi.capabilities(projectId, backendId as string),
    enabled: !!backendId,
    staleTime: 60_000,
    retry: false,
  });

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
  useEffect(() => {
    if (!availableTaskTypes.includes(taskType)) setTaskType("text");
  }, [availableTaskTypes, taskType]);
  const activeDocModel =
    taskType === "ocr" ? ocrModel : taskType === "doc_layout" ? docLayoutModel : undefined;
  const isDocMode = taskType === "ocr" || taskType === "doc_layout";

  const primaryModel = useMemo<MLModelCapability | undefined>(() => {
    if (isDocMode) return activeDocModel;
    // 过滤内部能力(检测原子): 不作对外预标默认/可选.
    const models = (capabilitiesQ.data?.models ?? []).filter((m) => m.visibility !== "internal");
    return models.find((m) => m.task !== "ocr" && m.task !== "doc_layout") ?? models[0];
  }, [isDocMode, activeDocModel, capabilitiesQ.data]);

  const geometricModels = useMemo<MLModelCapability[]>(
    () =>
      (capabilitiesQ.data?.models ?? []).filter(
        (m) => m.visibility !== "internal" && GEOMETRIC_TASKS.includes(m.task ?? ""),
      ),
    [capabilitiesQ.data],
  );
  const isGeometricBackend =
    !isDocMode &&
    geometricModels.length > 0 &&
    !(primaryModel?.supported_prompts ?? []).includes("text");
  const [geometricTaskId, setGeometricTaskId] = useState<string | null>(null);
  useEffect(() => {
    setGeometricTaskId((prev) =>
      prev && geometricModels.some((m) => m.id === prev)
        ? prev
        : (geometricModels[0]?.id ?? null),
    );
  }, [backendId, geometricModels]);
  const geometricModel =
    geometricModels.find((m) => m.id === geometricTaskId) ?? geometricModels[0];

  // v0.14.18 · 当前路径的 variant 来源 (修 #3 回归): doc → 文档 model; 几何 → 选中 task model;
  //   文本 prompt 批量 (gsam2) → **顶层** supported_variants (两组 sam+dino), 不绑单 model
  //   (primaryModel=detection 只表达 dino, 表达不全; 文本批量是后端级编排能力)。
  const isTextPath = !isDocMode && !isGeometricBackend;
  const variantSource = useMemo<VariantSource>(
    () =>
      deriveVariantSource({
        isDocMode,
        isGeometricBackend,
        activeDocModel,
        geometricModel,
        topSupportedVariants:
          setupQ.data?.supported_variants ?? capabilitiesQ.data?.supported_variants,
      }),
    [isDocMode, isGeometricBackend, activeDocModel, geometricModel, setupQ.data, capabilitiesQ.data],
  );

  // 输出形态: 文本路径走顶层 supported_text_outputs (box/mask/both); 其余仍按选中 model 几何输出。
  const panelShape = useMemo(() => {
    if (isTextPath) {
      return deriveTextPanelShape(
        setupQ.data?.supported_text_outputs ?? capabilitiesQ.data?.supported_text_outputs,
      );
    }
    return derivePanelShape(primaryModel, isDocMode);
  }, [isTextPath, isDocMode, primaryModel, setupQ.data, capabilitiesQ.data]);

  // v0.14.17 · 类别白名单: 选中的模型原生类别 index 子集 (空集=全部). 随 task 切换重置.
  const [selectedClassIdx, setSelectedClassIdx] = useState<Set<number>>(new Set());
  useEffect(() => {
    setSelectedClassIdx(new Set());
  }, [backendId, geometricTaskId]);

  // 文本任务用 /setup.params; OCR / 版面用所选 model 条目自带的 params schema.
  const paramsSchema = (
    isDocMode ? activeDocModel?.params : setupQ.data?.params
  ) as JsonSchemaObject | undefined;
  const paramKeys = Object.keys(paramsSchema?.properties ?? {});
  const hasAnyParams = paramKeys.length > 0;
  const hasNonVariantParams = paramKeys.some(
    (key) => !VARIANT_FIELD_KEYS.includes(key as (typeof VARIANT_FIELD_KEYS)[number]),
  );
  const { savedParams, save: saveParams } = useAiToolParamPrefs(backendId);
  const [paramsValue, setParamsValue] = useState<Record<string, unknown>>({});

  // v0.14.13 · 项目级 variant 偏好 merge backend 自报默认 (按当前路径的 variant 来源, 见 variantSource).
  const variantDefaults = useMemo<Record<string, string>>(() => {
    const fromBackend = variantSource.defaults ?? {};
    const fromProject =
      (backendId ? project?.default_variants?.[backendId] : undefined) ?? {};
    return { ...fromBackend, ...fromProject };
  }, [variantSource, project?.default_variants, backendId]);

  useEffect(() => {
    if (!backendId) return;
    setParamsValue({
      ...deriveDefaults(paramsSchema),
      ...variantDefaults,
      ...(savedParams ?? {}),
    });
  }, [backendId, paramsSchema, savedParams, variantDefaults]);

  const onParamsChange = (next: Record<string, unknown>) => {
    setParamsValue(next);
    saveParams(next);
  };

  // v0.14.13 · variant 写回项目级偏好 (debounced 跟随 PATCH).
  const updateProjectMu = useUpdateProject(projectId);
  const variantAxisKeysRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    variantAxisKeysRef.current = new Set(
      (variantSource.groups ?? [])
        .map((g) => g.key)
        .filter((k): k is string => typeof k === "string"),
    );
  }, [variantSource]);
  const patchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (patchTimerRef.current) clearTimeout(patchTimerRef.current);
  }, []);

  const onVariantOrParamsChange = (next: Record<string, unknown>) => {
    setParamsValue(next);
    saveParams(next);
    if (!backendId) return;
    const axisKeys = variantAxisKeysRef.current;
    if (axisKeys.size === 0) return;
    const variantSlice: Record<string, string> = {};
    for (const k of axisKeys) {
      const v = next[k];
      if (typeof v === "string") variantSlice[k] = v;
    }
    const currentProjectSlice = project?.default_variants?.[backendId] ?? {};
    const same =
      Object.keys(variantSlice).length === Object.keys(currentProjectSlice).length &&
      Object.entries(variantSlice).every(([k, v]) => currentProjectSlice[k] === v);
    if (same) return;
    const merged: Record<string, Record<string, string>> = {
      ...(project?.default_variants ?? {}),
      [backendId]: variantSlice,
    };
    if (patchTimerRef.current) clearTimeout(patchTimerRef.current);
    patchTimerRef.current = setTimeout(() => {
      updateProjectMu.mutate({ default_variants: merged });
    }, 300);
  };

  // v0.14.16 · 命名预设 (variant + params 快照, 按 backend×task 分桶 localStorage).
  const { presets, save: savePreset, remove: removePreset } = useAiParamPresets(
    backendId,
    taskType,
  );
  const applyPreset = (values: Record<string, unknown>) => {
    onVariantOrParamsChange({ ...deriveDefaults(paramsSchema), ...variantDefaults, ...values });
  };

  // v0.14.17 · 手动预热: 加载该 task 的类别表 (model.names) 以勾选类别白名单.
  const warmMut = useMutation({
    mutationFn: () => {
      const variants: Record<string, string> = {};
      for (const k of variantAxisKeysRef.current) {
        const v = paramsValue[k];
        if (typeof v === "string") variants[k] = v;
      }
      return mlBackendsApi.warmup(projectId, backendId as string, {
        task: geometricModel?.task,
        variants,
      });
    },
    onSuccess: () => {
      pushToast({ msg: "已预热，正在加载类别…", kind: "success" });
      qc.invalidateQueries({
        queryKey: ["ml-backends", projectId, backendId, "capabilities"],
      });
      qc.invalidateQueries({
        queryKey: ["ml-backends", projectId, backendId, "setup"],
      });
    },
    onError: (err) =>
      pushToast({ msg: "预热失败", sub: (err as Error)?.message, kind: "error" }),
  });

  // ── prompt (开放词表文本任务) ──
  const [prompt, setPrompt] = useState("");
  const [outputMode, setOutputMode] = useState<TextOutputMode>("mask");
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

  // 项目切换时重置 outputMode (按 type_key 分流) + prompt.
  useEffect(() => {
    setOutputMode(project?.type_key === "image-det" ? "box" : "mask");
    setPrompt("");
    defaultPromptAppliedRef.current = "";
  }, [projectId, project?.type_key]);

  // v0.9.12 · aliases 就绪且 prompt 仍空时, 默认勾选所有 alias 拼成逗号分隔 (按频率降序).
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

  // v0.14.13 · 当前 variant 选择是否已 warm (用于按钮文案分两态).
  const currentVariantSlice = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const k of variantAxisKeysRef.current) {
      const v = paramsValue[k];
      if (typeof v === "string") out[k] = v;
    }
    return out;
    // variantSource 变化 → variantAxisKeysRef (ref, 非响应) 可能更新, 显式入依赖一并重算.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsValue, variantSource]);
  // markHot 写入模块级缓存 (sessionVariantCache) 后, 仅靠 [backendId, currentVariantSlice] 无法
  // 感知缓存写入 → 同一 variant 连续跑两次时, 第二次仍读到旧的 false (按钮误显"加载模型中…")。
  // 用 warmTick 显式触发重算: markHot 写缓存后 bump, 让 isCurrentVariantWarm 重读缓存。
  const [warmTick, setWarmTick] = useState(0);
  const isCurrentVariantWarm = useMemo(() => {
    if (!backendId) return false;
    return isVariantHot(backendId, currentVariantSlice);
    // warmTick: markHot 后重算 (见 markHot); 否则模块缓存写入不被 useMemo 感知。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendId, currentVariantSlice, warmTick]);

  // 换 variant (series/size 等) 视为换模型: 重置类别白名单选择, 避免旧 variant 的勾选套到新模型.
  // (注: backend 的类别表按 task 缓存, 同 task 各 variant 类别一致时白名单内容不变; 此处仅清选择.)
  const variantKey = JSON.stringify(currentVariantSlice);
  useEffect(() => {
    setSelectedClassIdx(new Set());
  }, [variantKey]);

  /** 配置层的"可运行"判定 (不含批次/任务选择, 由调用方自行 && 上). */
  const configReady =
    !!backendId && (isDocMode || isGeometricBackend || !!prompt.trim());

  /** 构造单次请求字段袋 (ml_backend_id + 模式相关字段 + predict_mode); 不含 task_ids/batch_id. */
  const buildArgs = (predictMode: PredictMode): PreannotateArgs | null => {
    if (!backendId) return null;
    const effectiveOutputMode = panelShape.forcedOutputMode ?? outputMode;
    const variantSlice: Record<string, string> = {};
    const nonVariantParams: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(paramsValue)) {
      if (variantAxisKeysRef.current.has(k)) {
        if (typeof v === "string") variantSlice[k] = v;
      } else {
        nonVariantParams[k] = v;
      }
    }
    if (isGeometricBackend) {
      return {
        ml_backend_id: backendId,
        task_type: geometricModel?.task,
        model_id: geometricModel?.id,
        model_variants: variantSlice,
        params: nonVariantParams,
        predict_mode: predictMode,
        // 类别白名单: 空集 = 全部类别 (不下发 class_filter).
        ...(selectedClassIdx.size > 0
          ? { class_filter: Array.from(selectedClassIdx).sort((a, b) => a - b) }
          : {}),
      };
    }
    if (isDocMode) {
      return {
        ml_backend_id: backendId,
        model_id: activeDocModel?.id,
        task_type: taskType,
        params: paramsValue,
        predict_mode: predictMode,
      };
    }
    return {
      ml_backend_id: backendId,
      prompt: prompt.trim(),
      output_mode: effectiveOutputMode,
      params: paramsValue,
      predict_mode: predictMode,
    };
  };

  /** 推理成功后兜底标热 (异步 trigger 拿不到 cache_hit). */
  const markHot = () => {
    if (!backendId) return;
    if (Object.keys(currentVariantSlice).length > 0) {
      markVariantHot(backendId, currentVariantSlice);
      setWarmTick((n) => n + 1); // 触发 isCurrentVariantWarm 重算, 否则模块缓存写入不被感知
    }
  };

  return {
    backendId,
    // 数据查询态
    setupQ,
    capabilitiesQ,
    // 任务类型
    taskType,
    setTaskType,
    availableTaskTypes,
    hasDocTasks,
    isDocMode,
    activeDocModel,
    // 几何 task
    isGeometricBackend,
    geometricModels,
    geometricModel,
    geometricTaskId,
    setGeometricTaskId,
    // 类别白名单
    selectedClassIdx,
    setSelectedClassIdx,
    warmMut,
    // 模型 / 面板形态
    primaryModel,
    panelShape,
    paramsSchema,
    hasAnyParams,
    hasNonVariantParams,
    // v0.14.18 · 当前路径的 variant 来源 (文本路径=顶层两组; 几何/doc=选中 model). 供 VariantSelector.
    variantGroups: variantSource.groups,
    variantCombinations: variantSource.combinations,
    // variant / 参数
    paramsValue,
    variantDefaults,
    onParamsChange,
    onVariantOrParamsChange,
    // 预设
    presets,
    savePreset,
    removePreset,
    applyPreset,
    // prompt
    prompt,
    setPrompt,
    promptTokenSet,
    toggleAlias,
    aliases,
    // 输出形态
    outputMode,
    setOutputMode,
    // 运行
    configReady,
    buildArgs,
    markHot,
    currentVariantSlice,
    isCurrentVariantWarm,
  };
}

export type PreannotateConfig = ReturnType<typeof usePreannotateConfig>;
