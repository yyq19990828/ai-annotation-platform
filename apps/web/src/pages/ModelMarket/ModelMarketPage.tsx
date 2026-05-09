import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { RegisteredBackendsTab } from "./RegisteredBackendsTab";

// v0.9.12 BUG B-14 · 删 failed tab; 失败预测已迁到 /ai-pre/jobs?status=failed.
// FailedPredictionsTab.tsx 文件保留 (AIPreAnnotatePage 仍 import 此组件; 等 Phase 5 IA 重构一并清理).
// 模式市场只剩 RegisteredBackends 单视图, 不再做 tab 容器, ModelMarketPage 直接渲染.

export function ModelMarketPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  // 兼容老书签: ?tab=failed → 自动 redirect 到 /ai-pre/jobs?status=failed
  useEffect(() => {
    if (params.get("tab") === "failed") {
      navigate("/ai-pre/jobs?status=failed", { replace: true });
    }
  }, [params, navigate]);

  return (
    <div style={{ padding: "20px 28px 40px", maxWidth: 1480, margin: "0 auto" }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 4px", letterSpacing: "-0.01em" }}>
          模型市场
        </h1>
        <p style={{ color: "var(--color-fg-muted)", fontSize: 13, margin: 0 }}>
          全局只读总览：所有项目已注册的 ML Backend。
        </p>
      </div>

      <RegisteredBackendsTab />
    </div>
  );
}
