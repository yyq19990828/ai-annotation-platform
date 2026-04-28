import { TopBar } from "@/components/shell/TopBar";
import { Sidebar } from "@/components/shell/Sidebar";
import { ToastRack, useToastStore } from "@/components/ui/Toast";
import { DashboardPage } from "@/pages/Dashboard/DashboardPage";
import { WorkbenchPage } from "@/pages/Workbench/WorkbenchPage";
import { UsersPage } from "@/pages/Users/UsersPage";
import { ReviewPage } from "@/pages/Review/ReviewPage";
import { LoginPage } from "@/pages/Login/LoginPage";
import { useAppStore } from "@/stores/appStore";
import { useAuthStore } from "@/stores/authStore";
import type { ProjectResponse } from "@/api/projects";

export function App() {
  const { page, setPage, workspace } = useAppStore();
  const pushToast = useToastStore((s) => s.push);
  const token = useAuthStore((s) => s.token);

  if (!token) return <LoginPage />;

  const onOpenProject = (p: ProjectResponse) => {
    if (p.type_key === "image-det") {
      useAppStore.getState().setCurrentProject(p);
      setPage("annotate");
    } else {
      pushToast({ msg: `项目 "${p.name}" 已打开`, sub: `类型 ${p.type_label} 的标注界面尚未实现` });
    }
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "220px 1fr",
        gridTemplateRows: "48px 1fr",
        height: "100vh",
        overflow: "hidden",
      }}
    >
      <TopBar workspace={workspace} onWorkspaceChange={() => pushToast({ msg: "切换工作区面板已展开" })} />
      <Sidebar page={page} setPage={setPage} reviewCount={0} />
      <main style={{ overflow: "auto", background: "var(--color-bg)" }}>
        {page === "dashboard" && <DashboardPage onOpenProject={onOpenProject} />}
        {page === "annotate" && <WorkbenchPage onBack={() => setPage("dashboard")} />}
        {page === "users" && <UsersPage />}
        {page === "review" && <ReviewPage />}
        {page !== "dashboard" && page !== "annotate" && page !== "users" && page !== "review" && (
          <div style={{ padding: "60px 28px", textAlign: "center", color: "var(--color-fg-subtle)" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🚧</div>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--color-fg)", margin: "0 0 8px" }}>
              {page === "datasets" ? "数据集" :
               page === "storage" ? "存储管理" :
               page === "ai-pre" ? "AI 预标注" :
               page === "model-market" ? "模型市场" :
               page === "training" ? "训练队列" :
               page === "audit" ? "审计日志" :
               page === "settings" ? "设置" : page}
            </h2>
            <p style={{ fontSize: 13, margin: 0 }}>此功能模块正在开发中</p>
          </div>
        )}
      </main>
      <ToastRack />
    </div>
  );
}
