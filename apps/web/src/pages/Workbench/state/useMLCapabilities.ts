import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  mlBackendsApi,
  mlBackendSetupQueryKey,
  type MLBackendCapability,
  type MLModelCapability,
} from "@/api/ml-backends";

// v0.10.1 · M1 (Capability 协商基础设施).
// 单一事实源: ToolDock 哪些 AI 工具可用 / 参数面板渲染哪些字段, 全部读这里.
// 本期 (M1) 只挂载、不消费; M2 (Prompt-first ToolDock) 才接 isPromptSupported.
//
// 兜底契约: 后端未升级到 v0.10.1 (缺 supported_prompts) 时返回 grounded-sam2 历史
// 三件套, 控制台 warn 一次, 让平台仍能跑老路径; 拉取失败时返回空 prompts (=禁用全 AI 工具).
//
// v0.14.9 · 能力声明协议 v2: 当 /setup 暴露 capability.models[] (一个 backend N 个 model) 时,
// 引入 activeModel 概念 — prompts/paramsSchema 优先取 active model 的字段;
// 无 models (grounded-sam2 / sam3 等单模型) 时完全回落到顶层逻辑, 行为与改造前一致 (向后兼容).

// v0.18.17 · bbox→interactive_box (统一双 backend 命名); fallback 用于 backend 未声明 supported_prompts.
const FALLBACK_PROMPTS = ["point", "interactive_box", "text"] as const;

export interface MLCapabilitiesResult {
  /** 后端声明支持的 prompt 类型. 拉取失败 -> []; 缺字段 -> FALLBACK_PROMPTS. 有 activeModel 时优先取 model.supported_prompts. */
  prompts: string[];
  /** 后端 /setup.params (JSON Schema Draft-07 子集). 缺字段 -> undefined. 有 activeModel 时优先取 model.params. */
  paramsSchema: MLBackendCapability["params"] | undefined;
  /** 当前精确 model 声明的输入形态。 */
  inputs: string[];
  /** 原始 capability 响应 (供调试 / 高级消费). */
  capability: MLBackendCapability | undefined;
  isPromptSupported: (type: string) => boolean;
  isInputSupported: (type: string) => boolean;
  isLoading: boolean;
  isError: boolean;
  // v0.14.9 · 多模型目录 (capability.models). 长度 <= 1 时上层不应渲染选择器 (向后兼容).
  models: MLModelCapability[];
  /** 当前激活 model; 无 models 时为 undefined. */
  activeModel: MLModelCapability | undefined;
  activeModelId: string | undefined;
  setActiveModelId: (id: string) => void;
  /** capability.models 长度 > 1 时为 true; 上层据此决定是否渲染多模型选择器. */
  hasMultipleModels: boolean;
}

/** 默认 active model: 优先第一个 is_interactive 的, 否则第一个. */
function pickDefaultModel(models: MLModelCapability[]): MLModelCapability | undefined {
  if (models.length === 0) return undefined;
  return models.find((m) => m.is_interactive) ?? models[0];
}

export function useMLCapabilities(
  projectId: string | undefined | null,
  backendId: string | undefined | null,
  // v0.18.25 · 引擎(模型)选择的服务端持久化偏好 (按 backend, 来自 User.preferences.ai.model_by_backend,
  // 经 useAiToolModelPref 注入)。作"默认之前的回落": 用户本会话显式选择 (selectedModelId) > 本偏好 >
  // pickDefaultModel。镜像 useBackendRouting 的 preferred→default 模式; 不在本 hook 内做副作用, 保持纯净可测。
  preferredModelId?: string | null,
  requirement?: {
    prompt: string;
    requiredInputs: string[];
    output: string;
  } | null,
): MLCapabilitiesResult {
  const enabled = Boolean(projectId && backendId);
  const query = useQuery({
    queryKey: mlBackendSetupQueryKey(projectId, backendId),
    queryFn: () => mlBackendsApi.setup(projectId!, backendId!),
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: 0,
  });

  const capability = query.data;
  const allModels = useMemo<MLModelCapability[]>(
    // 工作台多模型选择器: 不过滤 (含 composite, 用户可手动选一锅端)。
    () => (Array.isArray(capability?.models) ? capability!.models : []),
    [capability],
  );
  const models = useMemo<MLModelCapability[]>(() => {
    if (!requirement) return allModels;
    return allModels.filter(
      (model) => (model.supported_prompts ?? []).includes(requirement.prompt)
        && (model.supported_geometric_outputs ?? []).includes(requirement.output)
        && requirement.requiredInputs.every(
          (input) => (model.supported_inputs ?? []).includes(input),
        ),
    );
  }, [allModels, requirement]);

  // 用户显式选中的 model id; 未选时回落默认. 切 backend 时 capability/models 变, 选中失效自动回落默认.
  const [selectedModelId, setSelectedModelId] = useState<string | undefined>(undefined);
  const activeModel = useMemo<MLModelCapability | undefined>(() => {
    if (models.length === 0) return undefined;
    // 优先级: 本会话显式选择 > 服务端持久化偏好 > 默认; 各级都校验仍是合法 model (后端被删/换档自愈)。
    const bySession = selectedModelId
      ? models.find((m) => m.id === selectedModelId)
      : undefined;
    const byPref = preferredModelId
      ? models.find((m) => m.id === preferredModelId)
      : undefined;
    return bySession ?? byPref ?? pickDefaultModel(models);
  }, [models, selectedModelId, preferredModelId]);

  let prompts: string[];
  if (query.isError) {
    prompts = [];
  } else if (activeModel && Array.isArray(activeModel.supported_prompts)) {
    // 有 activeModel: 优先取 model 的 supported_prompts (即便为空也尊重 — 该 model 不接受任何 prompt).
    prompts = activeModel.supported_prompts;
  } else if (requirement && allModels.length > 0) {
    prompts = [];
  } else if (capability && Array.isArray(capability.supported_prompts)) {
    prompts = capability.supported_prompts;
  } else if (capability) {
    if (typeof console !== "undefined") {
      console.warn(
        "[useMLCapabilities] backend /setup missing supported_prompts; falling back to point/interactive_box/text. Upgrade backend to v0.10.1+.",
      );
    }
    prompts = [...FALLBACK_PROMPTS];
  } else {
    prompts = [];
  }

  // paramsSchema: 有 activeModel 且其带 params 时优先取 model.params, 否则回落顶层.
  const paramsSchema =
    activeModel?.params && Object.keys(activeModel.params.properties ?? {}).length > 0
      ? activeModel.params
      : capability?.params;
  const inputs = activeModel?.supported_inputs ?? capability?.supported_inputs ?? [];

  return {
    prompts,
    paramsSchema,
    inputs,
    capability,
    isPromptSupported: (type: string) => prompts.includes(type),
    isInputSupported: (type: string) => inputs.includes(type),
    isLoading: query.isLoading,
    isError: query.isError,
    models,
    activeModel,
    activeModelId: activeModel?.id,
    setActiveModelId: setSelectedModelId,
    hasMultipleModels: models.length > 1,
  };
}
