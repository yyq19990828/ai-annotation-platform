import { TopBar } from "@/components/shell/TopBar";
import { Sidebar } from "@/components/shell/Sidebar";
import { ToastRack, useToastStore } from "@/components/ui/Toast";
import { DashboardPage } from "@/pages/Dashboard/DashboardPage";
import { AdminDashboard } from "@/pages/Dashboard/AdminDashboard";
import { ReviewerDashboard } from "@/pages/Dashboard/ReviewerDashboard";
import { AnnotatorDashboard } from "@/pages/Dashboard/AnnotatorDashboard";
import { ViewerDashboard } from "@/pages/Dashboard/ViewerDashboard";
import { WorkbenchPage } from "@/pages/Workbench/WorkbenchPage";
import { UsersPage } from "@/pages/Users/UsersPage";
import { ReviewPage } from "@/pages/Review/ReviewPage";
import { LoginPage } from "@/pages/Login/LoginPage";
import { DatasetsPage } from "@/pages/Datasets/DatasetsPage";
import { StoragePage } from "@/pages/Storage/StoragePage";
import { UnauthorizedPage } from "@/pages/Unauthorized/UnauthorizedPage";
import { usePermissions } from "@/hooks/usePermissions";
import { useAppStore } from "@/stores/appStore";
import { useAuthStore } from "@/stores/authStore";
import type { ProjectResponse } from "@/api/projects";

function DashboardRouter({ onOpenProject }: { onOpenProject: (p: ProjectResponse) => void }) {
  const { role } = usePermissions();
  switch (role) {
    case "super_admin": return <AdminDashboard />;
    case "project_admin": return <DashboardPage onOpenProject={onOpenProject} />;
    case "reviewer": return <ReviewerDashboard />;
    case "annotator": return <AnnotatorDashboard />;
    case "viewer": return <ViewerDashboard onOpenProject={onOpenProject} />;
    default: return <DashboardPage onOpenProject={onOpenProject} />;
  }
}

export function App() {
  const { page, setPage, workspace } = useAppStore();
  const pushToast = useToastStore((s) => s.push);
  const token = useAuthStore((s) => s.token);
  const { canAccessPage } = usePermissions();

  if (!token) return <LoginPage />;

  const onOpenProject = (p: ProjectResponse) => {
    if (p.type_key === "image-det") {
      useAppStore.getState().setCurrentProject(p);
      setPage("annotate");
    } else {
      pushToast({ msg: `项目 "${p.name}" 已打开`, sub: `类型 ${p.type_label} 的标注界面尚未实现` });
    }
  };

  if (page === "annotate") {
    return (
      <div style={{ height: "100vh", overflow: "hidden" }}>
        <WorkbenchPage onBack={() => setPage("dashboard")} />
        <ToastRack />
      </div>
    );
  }

  const renderPage = () => {
    if (page !== "dashboard" && !canAccessPage(page)) {
      return <UnauthorizedPage />;
    }
    switch (page) {
      case "dashboard": return <DashboardRouter onOpenProject={onOpenProject} />;
      case "users": return <UsersPage />;
      case "review": return <ReviewPage />;
      case "datasets": return <DatasetsPage />;
      case "storage": return <StoragePage />;
      default: return (
        <div style={{ padding: "60px 28px", textAlign: "center", color: "var(--color-fg-subtle)" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🚧</div>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--color-fg)", margin: "0 0 8px" }}>
            {page === "ai-pre" ? "AI 预标注" :
             page === "model-market" ? "模型市场" :
             page === "training" ? "训练队列" :
             page === "audit" ? "审计日志" :
             page === "settings" ? "设置" : page}
          </h2>
          <p style={{ fontSize: 13, margin: 0 }}>此功能模块正在开发中</p>
        </div>
      );
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
        {renderPage()}
      </main>
      <ToastRack />
    </div>
  );
}
