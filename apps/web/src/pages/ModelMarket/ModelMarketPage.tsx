import { useSearchParams } from "react-router-dom";
import { Icon } from "@/components/ui/Icon";
import type { IconName } from "@/components/ui/Icon";
import { useFailedPredictions } from "@/hooks/useFailedPredictions";
import { RegisteredBackendsTab } from "./RegisteredBackendsTab";
import { FailedPredictionsTab } from "./FailedPredictionsTab";

type TabKey = "backends" | "failed";

const TABS: { key: TabKey; label: string; icon: IconName }[] = [
  { key: "backends", label: "已接入 Backend", icon: "bot" },
  { key: "failed", label: "失败预测", icon: "warning" },
];

export function ModelMarketPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const active: TabKey = raw === "failed" ? "failed" : "backends";

  const failedQuery = useFailedPredictions(1, 1, false);
  const failedTotal = failedQuery.data?.total ?? 0;

  const setTab = (key: TabKey) => {
    const next = new URLSearchParams(params);
    if (key === "backends") next.delete("tab");
    else next.set("tab", key);
    setParams(next, { replace: true });
  };

  return (
    <div style={{ padding: "20px 28px 40px", maxWidth: 1480, margin: "0 auto" }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 4px", letterSpacing: "-0.01em" }}>
          模型市场
        </h1>
        <p style={{ color: "var(--color-fg-muted)", fontSize: 13, margin: 0 }}>
          全局只读总览：所有项目已注册的 ML Backend，以及调用失败的预测重试管理。
        </p>
      </div>

      <div
        role="tablist"
        style={{
          display: "inline-flex",
          gap: 0,
          borderBottom: "1px solid var(--color-border)",
          marginBottom: 16,
        }}
      >
        {TABS.map((t) => {
          const selected = active === t.key;
          const showBadge = t.key === "failed" && failedTotal > 0;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={selected}
              onClick={() => setTab(t.key)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: 500,
                background: "transparent",
                color: selected ? "var(--color-fg)" : "var(--color-fg-muted)",
                border: "none",
                borderBottom: selected
                  ? "2px solid var(--color-accent)"
                  : "2px solid transparent",
                marginBottom: -1,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              <Icon name={t.icon} size={13} />
              {t.label}
              {showBadge && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minWidth: 18,
                    height: 18,
                    padding: "0 5px",
                    borderRadius: 9,
                    background: "var(--color-danger)",
                    color: "white",
                    fontSize: 10,
                    fontWeight: 600,
                  }}
                >
                  {failedTotal > 99 ? "99+" : failedTotal}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {active === "backends" && <RegisteredBackendsTab />}
      {active === "failed" && <FailedPredictionsTab />}
    </div>
  );
}
