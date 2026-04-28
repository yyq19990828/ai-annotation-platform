import { Navigate, Outlet, Route, Routes } from "react-router-dom";
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
import { RequireAuth } from "@/components/routing/RequireAuth";
import { RequirePagePermission } from "@/components/routing/RequirePagePermission";
import { usePermissions } from "@/hooks/usePermissions";
import { useAppStore } from "@/stores/appStore";

function DashboardRouter() {
  const { role } = usePermissions();
  switch (role) {
    case "super_admin":
      return <AdminDashboard />;
    case "project_admin":
      return <DashboardPage />;
    case "reviewer":
      return <ReviewerDashboard />;
    case "annotator":
      return <AnnotatorDashboard />;
    case "viewer":
      return <ViewerDashboard />;
    default:
      return <DashboardPage />;
  }
}

function AppShell() {
  const workspace = useAppStore((s) => s.workspace);
  const pushToast = useToastStore((s) => s.push);

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
      <Sidebar reviewCount={0} />
      <main style={{ overflow: "auto", background: "var(--color-bg)" }}>
        <Outlet />
      </main>
      <ToastRack />
    </div>
  );
}

function PlaceholderPage({ title }: { title: string }) {
  return (
    <div style={{ padding: "60px 28px", textAlign: "center", color: "var(--color-fg-subtle)" }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>🚧</div>
      <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--color-fg)", margin: "0 0 8px" }}>{title}</h2>
      <p style={{ fontSize: 13, margin: 0 }}>此功能模块正在开发中</p>
    </div>
  );
}

function FullScreenWorkbench() {
  return (
    <div style={{ height: "100vh", overflow: "hidden" }}>
      <WorkbenchPage />
      <ToastRack />
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        path="/projects/:id/annotate"
        element={
          <RequireAuth>
            <FullScreenWorkbench />
          </RequireAuth>
        }
      />

      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardRouter />} />
        <Route
          path="/review"
          element={
            <RequirePagePermission pageKey="review">
              <ReviewPage />
            </RequirePagePermission>
          }
        />
        <Route
          path="/users"
          element={
            <RequirePagePermission pageKey="users">
              <UsersPage />
            </RequirePagePermission>
          }
        />
        <Route
          path="/datasets"
          element={
            <RequirePagePermission pageKey="datasets">
              <DatasetsPage />
            </RequirePagePermission>
          }
        />
        <Route
          path="/storage"
          element={
            <RequirePagePermission pageKey="storage">
              <StoragePage />
            </RequirePagePermission>
          }
        />
        <Route
          path="/ai-pre"
          element={
            <RequirePagePermission pageKey="ai-pre">
              <PlaceholderPage title="AI 预标注" />
            </RequirePagePermission>
          }
        />
        <Route
          path="/model-market"
          element={
            <RequirePagePermission pageKey="model-market">
              <PlaceholderPage title="模型市场" />
            </RequirePagePermission>
          }
        />
        <Route
          path="/training"
          element={
            <RequirePagePermission pageKey="training">
              <PlaceholderPage title="训练队列" />
            </RequirePagePermission>
          }
        />
        <Route
          path="/audit"
          element={
            <RequirePagePermission pageKey="audit">
              <PlaceholderPage title="审计日志" />
            </RequirePagePermission>
          }
        />
        <Route
          path="/settings"
          element={
            <RequirePagePermission pageKey="settings">
              <PlaceholderPage title="设置" />
            </RequirePagePermission>
          }
        />
        <Route path="/unauthorized" element={<UnauthorizedPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
