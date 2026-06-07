import { useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueries, useQuery } from "@tanstack/react-query";
import { StatCard } from "@/components/ui/StatCard";
import { Icon } from "@/components/ui/Icon";
import { adminMlIntegrationsApi } from "@/api/adminMlIntegrations";
import { mlBackendsApi } from "@/api/ml-backends";
import { RegisteredBackendsTab } from "./RegisteredBackendsTab";
import { RuntimeObservePanel } from "./RuntimeObservePanel";
import { CapabilityCatalogPanel } from "./CapabilityCatalogPanel";
import styles from "./ModelMarketPage.module.css";

// v0.9.12 BUG B-14 · 删 failed tab; 失败预测已迁到 /ai-pre/jobs?status=failed.
// FailedPredictionsTab.tsx 文件保留 (AIPreAnnotatePage 仍 import 此组件; 等 Phase 5 IA 重构一并清理).
type MarketTab = "catalog" | "runtime" | "registry";

const TABS: { key: MarketTab; label: string; icon: "layers" | "activity" | "bot" }[] = [
  { key: "catalog", label: "能力目录", icon: "layers" },
  { key: "runtime", label: "运行时观测", icon: "activity" },
  { key: "registry", label: "注册管理", icon: "bot" },
];

export function ModelMarketPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const activeTab = parseTab(params.get("tab"));

  const overviewQ = useQuery({
    queryKey: ["admin", "ml-integrations", "overview"],
    queryFn: () => adminMlIntegrationsApi.overview(),
    refetchInterval: 60_000,
  });
  const backendRefs = useMemo(() => {
    const refs: { projectId: string; backendId: string }[] = [];
    for (const project of overviewQ.data?.projects ?? []) {
      for (const backend of project.backends) {
        refs.push({ projectId: backend.project_id, backendId: backend.id });
      }
    }
    return refs;
  }, [overviewQ.data]);
  const capabilityQueries = useQueries({
    queries: backendRefs.map((ref) => ({
      queryKey: ["ml-backend-capabilities", ref.projectId, ref.backendId],
      queryFn: () => mlBackendsApi.capabilities(ref.projectId, ref.backendId),
      staleTime: 60_000,
    })),
  });
  const modelCount = capabilityQueries.reduce((sum, query) => {
    if (!query.data) return sum;
    return sum + (query.data.models?.length || 1);
  }, 0);
  const modelCountLoading =
    backendRefs.length > 0 && capabilityQueries.some((query) => query.isLoading);

  // 兼容老书签: ?tab=failed → 自动 redirect 到 /ai-pre/jobs?status=failed
  useEffect(() => {
    if (params.get("tab") === "failed") {
      navigate("/ai-pre/jobs?status=failed", { replace: true });
    }
  }, [params, navigate]);

  const setTab = (tab: MarketTab) => {
    const next = new URLSearchParams(params);
    next.set("tab", tab);
    setParams(next, { replace: true });
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>模型市场</h1>
        <p className={styles.subtitle}>
          全局总览：env 配置的 AI 后端容器（直连观测）+ 所有项目已注册的 ML Backend 及其能力目录。
          {/* v0.10.38 · 视频追踪任务监控已迁至 /ai-pre/jobs 视频 tab (epic 阶段 3) */}
        </p>
      </div>

      <div className={styles.statsGrid}>
        <StatCard
          icon="bot"
          label="ML Backend"
          value={`${overviewQ.data?.connected_backends ?? 0} / ${overviewQ.data?.total_backends ?? 0}`}
          hint="已连接 / 总数"
        />
        <StatCard
          icon="folder"
          label="使用项目"
          value={String(overviewQ.data?.projects.length ?? 0)}
          hint="AI 已启用或已注册 backend 的项目"
        />
        <StatCard
          icon="layers"
          label="模型条目"
          value={modelCountLoading ? "探测中" : String(modelCount)}
          hint="能力目录 models[] 汇总"
        />
      </div>

      <div className={styles.segmented} role="tablist" aria-label="模型市场视图">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            className={activeTab === tab.key ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            onClick={() => setTab(tab.key)}
          >
            <Icon name={tab.icon} size={13} />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "catalog" && <CapabilityCatalogPanel />}
      {activeTab === "runtime" && <RuntimeObservePanel />}
      {activeTab === "registry" && <RegisteredBackendsTab />}
    </div>
  );
}

function parseTab(value: string | null): MarketTab {
  if (value === "runtime" || value === "registry" || value === "catalog") return value;
  return "catalog";
}
