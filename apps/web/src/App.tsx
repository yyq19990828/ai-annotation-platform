import { useState, useEffect, lazy, Suspense } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { TopBar } from "@/components/shell/TopBar";
import { useNotificationSocket } from "@/hooks/useNotificationSocket";
import { useHeartbeat } from "@/hooks/useHeartbeat";
import { Sidebar } from "@/components/shell/Sidebar";
import { SidebarDrawer } from "@/components/shell/SidebarDrawer";
import { ToastRack, useToastStore } from "@/components/ui/Toast";
// 仪表盘 / 登录 类首屏关键路径：保持同步加载（避免 Suspense 闪烁）
import { DashboardPage } from "@/pages/Dashboard/DashboardPage";
import { AdminDashboard } from "@/pages/Dashboard/AdminDashboard";
import { AdminPeoplePage } from "@/pages/Admin/AdminPeoplePage";
import { ReviewerDashboard } from "@/pages/Dashboard/ReviewerDashboard";
import { AnnotatorDashboard } from "@/pages/Dashboard/AnnotatorDashboard";
import { ViewerDashboard } from "@/pages/Dashboard/ViewerDashboard";
import { LoginPage } from "@/pages/Login/LoginPage";
import { ForgotPasswordPage } from "@/pages/Login/ForgotPasswordPage";
import { ResetPasswordPage } from "@/pages/Login/ResetPasswordPage";
import { RegisterPage } from "@/pages/Register/RegisterPage";
import { UnauthorizedPage } from "@/pages/Unauthorized/UnauthorizedPage";

// v0.6.6 · 重型 / 非首屏页面 lazy-load，让登录 / 仪表盘不下载 konva 等
const WorkbenchPage = lazy(() =>
  import("@/pages/Workbench/WorkbenchPage").then((m) => ({ default: m.WorkbenchPage }))
);
const UsersPage = lazy(() =>
  import("@/pages/Users/UsersPage").then((m) => ({ default: m.UsersPage }))
);
const ReviewPage = lazy(() =>
  import("@/pages/Review/ReviewPage").then((m) => ({ default: m.ReviewPage }))
);
const AnnotatePage = lazy(() =>
  import("@/pages/Annotate/AnnotatePage").then((m) => ({ default: m.AnnotatePage }))
);
const DatasetsPage = lazy(() =>
  import("@/pages/Datasets/DatasetsPage").then((m) => ({ default: m.DatasetsPage }))
);
const StoragePage = lazy(() =>
  import("@/pages/Storage/StoragePage").then((m) => ({ default: m.StoragePage }))
);
const ProjectSettingsPage = lazy(() =>
  import("@/pages/Projects/ProjectSettingsPage").then((m) => ({ default: m.ProjectSettingsPage }))
);
const AuditPage = lazy(() =>
  import("@/pages/Audit/AuditPage").then((m) => ({ default: m.AuditPage }))
);
const BugsPage = lazy(() =>
  import("@/pages/Bugs/BugsPage").then((m) => ({ default: m.BugsPage }))
);
const SettingsPage = lazy(() =>
  import("@/pages/Settings/SettingsPage").then((m) => ({ default: m.SettingsPage }))
);
const ModelMarketPage = lazy(() =>
  import("@/pages/ModelMarket/ModelMarketPage").then((m) => ({ default: m.ModelMarketPage }))
);
import { RequireAuth } from "@/components/routing/RequireAuth";
import { RequirePagePermission } from "@/components/routing/RequirePagePermission";
import { RequireProjectMember } from "@/components/routing/RequireProjectMember";
import { usePermissions } from "@/hooks/usePermissions";
import { useAppStore } from "@/stores/appStore";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { BugReportFAB } from "@/components/bugreport/BugReportFAB";
import { BugReportDrawer } from "@/components/bugreport/BugReportDrawer";
import { initBugReportCapture, patchFetchForBugCapture } from "@/utils/bugReportCapture";
import { PageLoader } from "@/components/PageLoader";
import { useBugDrawerStore } from "@/stores/bugDrawerStore";

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
  const compact = useMediaQuery("(max-width: 1023px)");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const bugDrawerOpen = useBugDrawerStore((s) => s.open);
  const bugDrawerFocusId = useBugDrawerStore((s) => s.focusBugId);
  const openBugDrawer = useBugDrawerStore((s) => s.openDrawer);
  const closeBugDrawer = useBugDrawerStore((s) => s.close);

  // 初始化 bug 反馈自动捕获
  useEffect(() => {
    patchFetchForBugCapture();
    initBugReportCapture();
  }, []);

  useNotificationSocket();
  useHeartbeat();

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: compact ? "0 1fr" : "220px 1fr",
        gridTemplateRows: "48px 1fr",
        height: "100vh",
        overflow: "hidden",
      }}
    >
      <TopBar
        workspace={workspace}
        onWorkspaceChange={() => pushToast({ msg: "切换工作区面板已展开" })}
        showHamburger={compact}
        onOpenDrawer={() => setDrawerOpen(true)}
      />
      {compact ? (
        <>
          <aside style={{ width: 0, overflow: "hidden" }} aria-hidden="true" />
          <SidebarDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
            <Sidebar reviewCount={0} />
          </SidebarDrawer>
        </>
      ) : (
        <Sidebar reviewCount={0} />
      )}
      <main style={{ overflow: "auto", background: "var(--color-bg)" }}>
        <Suspense fallback={<PageLoader />}>
          <Outlet />
        </Suspense>
      </main>
      <ToastRack />
      <BugReportFAB onClick={() => openBugDrawer()} />
      <BugReportDrawer open={bugDrawerOpen} focusBugId={bugDrawerFocusId} onClose={closeBugDrawer} />
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
  const tooNarrow = useMediaQuery("(max-width: 767px)");
  const bugDrawerOpen = useBugDrawerStore((s) => s.open);
  const bugDrawerFocusId = useBugDrawerStore((s) => s.focusBugId);
  const openBugDrawer = useBugDrawerStore((s) => s.openDrawer);
  const closeBugDrawer = useBugDrawerStore((s) => s.close);

  useEffect(() => {
    patchFetchForBugCapture();
    initBugReportCapture();
  }, []);
  useHeartbeat();

  return (
    <div style={{ height: "100vh", overflow: "hidden", position: "relative" }}>
      <Suspense fallback={<PageLoader />}>
        <WorkbenchPage />
      </Suspense>
      <ToastRack />
      <BugReportFAB onClick={() => openBugDrawer()} />
      <BugReportDrawer open={bugDrawerOpen} focusBugId={bugDrawerFocusId} onClose={closeBugDrawer} />
      {tooNarrow && <MobileWorkbenchBlock />}
    </div>
  );
}

function MobileWorkbenchBlock() {
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 18, 25, 0.92)",
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        textAlign: "center",
        color: "#f5f7fb",
        backdropFilter: "blur(6px)",
      }}
    >
      <div style={{ fontSize: 38, marginBottom: 12 }}>🖥️</div>
      <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 6px" }}>请切换到桌面端</h2>
      <p style={{ fontSize: 13, color: "#c8cdd6", margin: "0 0 14px", maxWidth: 360, lineHeight: 1.55 }}>
        标注工作台依赖快捷键、画布鼠标交互和大屏侧栏。当前屏幕小于 768px，仅以只读方式展示，避免误操作。
      </p>
      <div style={{ fontSize: 12, color: "#8c93a3" }}>建议宽度 ≥ 1024px</div>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      <Route
        path="/projects/:id/annotate"
        element={
          <RequireAuth>
            <RequireProjectMember>
              <FullScreenWorkbench />
            </RequireProjectMember>
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
          path="/admin/people"
          element={
            <RequirePagePermission pageKey="admin-people">
              <AdminPeoplePage />
            </RequirePagePermission>
          }
        />
        {/* v0.9.3 phase 2 · /admin/failed-predictions 与 /admin/ml-integrations 已合并到 /model-market */}
        <Route
          path="/review"
          element={
            <RequirePagePermission pageKey="review">
              <ReviewPage />
            </RequirePagePermission>
          }
        />
        <Route
          path="/annotate"
          element={
            <RequirePagePermission pageKey="annotate">
              <AnnotatePage />
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
              <ModelMarketPage />
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
              <AuditPage />
            </RequirePagePermission>
          }
        />
        <Route
          path="/bugs"
          element={
            <RequirePagePermission pageKey="bugs">
              <BugsPage />
            </RequirePagePermission>
          }
        />
        <Route
          path="/settings"
          element={
            <RequirePagePermission pageKey="settings">
              <SettingsPage />
            </RequirePagePermission>
          }
        />
        <Route path="/projects/:id/settings" element={<ProjectSettingsPage />} />
        <Route path="/unauthorized" element={<UnauthorizedPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
