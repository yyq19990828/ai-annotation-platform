/**
 * v0.9.8 · /ai-pre Layout — 顶部 tab 切「执行 / 历史」, 子路由渲染.
 */

import { Link, Outlet, useLocation } from "react-router-dom";
import { PAGE_PADDING_X, FS_MD } from "./styles";

const tabBaseStyle = {
  padding: "8px 14px",
  fontSize: FS_MD,
  fontWeight: 500,
  color: "var(--color-fg-muted)",
  textDecoration: "none",
  borderBottom: "2px solid transparent",
  transition: "color 120ms ease, border-color 120ms ease",
};

const tabActiveStyle = {
  ...tabBaseStyle,
  color: "var(--color-ai)",
  borderBottomColor: "var(--color-ai)",
};

export default function AIPreAnnotateLayout() {
  const { pathname } = useLocation();
  const isJobs = pathname.endsWith("/jobs");

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100%" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: `0 ${PAGE_PADDING_X}px`,
          borderBottom: "1px solid var(--color-border)",
          background: "var(--color-bg)",
        }}
      >
        <Link to="/ai-pre" style={!isJobs ? tabActiveStyle : tabBaseStyle}>
          执行预标
        </Link>
        <Link to="/ai-pre/jobs" style={isJobs ? tabActiveStyle : tabBaseStyle}>
          完整历史
        </Link>
      </div>
      <Outlet />
    </div>
  );
}
