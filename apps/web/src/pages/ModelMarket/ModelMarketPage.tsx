import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { RegisteredBackendsTab } from "./RegisteredBackendsTab";
import { ObserveBackendsPanel } from "./ObserveBackendsPanel";
import styles from "./ModelMarketPage.module.css";

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
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>模型市场</h1>
        <p className={styles.subtitle}>
          全局总览：env 配置的 AI 后端容器（直连观测）+ 所有项目已注册的 ML Backend。
        </p>
      </div>

      <ObserveBackendsPanel />
      <RegisteredBackendsTab />
    </div>
  );
}
