import { useQuery } from "@tanstack/react-query";
import { mlBackendsApi, type MLBackendCapability } from "@/api/ml-backends";

// v0.10.1 · M1 (Capability 协商基础设施).
// 单一事实源: ToolDock 哪些 AI 工具可用 / 参数面板渲染哪些字段, 全部读这里.
// 本期 (M1) 只挂载、不消费; M2 (Prompt-first ToolDock) 才接 isPromptSupported.
//
// 兜底契约: 后端未升级到 v0.10.1 (缺 supported_prompts) 时返回 grounded-sam2 历史
// 三件套, 控制台 warn 一次, 让平台仍能跑老路径; 拉取失败时返回空 prompts (=禁用全 AI 工具).

const FALLBACK_PROMPTS = ["point", "bbox", "text"] as const;

export interface MLCapabilitiesResult {
  /** 后端声明支持的 prompt 类型. 拉取失败 -> []; 缺字段 -> FALLBACK_PROMPTS. */
  prompts: string[];
  /** 后端 /setup.params (JSON Schema Draft-07 子集). 缺字段 -> undefined. */
  paramsSchema: MLBackendCapability["params"] | undefined;
  /** 原始 capability 响应 (供调试 / 高级消费). */
  capability: MLBackendCapability | undefined;
  isPromptSupported: (type: string) => boolean;
  isLoading: boolean;
  isError: boolean;
}

export function useMLCapabilities(
  projectId: string | undefined | null,
  backendId: string | undefined | null,
): MLCapabilitiesResult {
  const enabled = Boolean(projectId && backendId);
  const query = useQuery({
    queryKey: ["ml-capabilities", projectId, backendId],
    queryFn: () => mlBackendsApi.setup(projectId!, backendId!),
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: 0,
  });

  const capability = query.data;
  let prompts: string[];
  if (query.isError) {
    prompts = [];
  } else if (capability && Array.isArray(capability.supported_prompts)) {
    prompts = capability.supported_prompts;
  } else if (capability) {
    if (typeof console !== "undefined") {
      console.warn(
        "[useMLCapabilities] backend /setup missing supported_prompts; falling back to point/bbox/text. Upgrade backend to v0.10.1+.",
      );
    }
    prompts = [...FALLBACK_PROMPTS];
  } else {
    prompts = [];
  }

  return {
    prompts,
    paramsSchema: capability?.params,
    capability,
    isPromptSupported: (type: string) => prompts.includes(type),
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
