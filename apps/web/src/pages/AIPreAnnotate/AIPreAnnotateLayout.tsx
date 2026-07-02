/**
 * v0.9.8 · /ai-pre Layout — 顶部 tab 切「执行 / 历史」, 子路由渲染.
 */

import { Link, Outlet, useLocation } from "react-router-dom";
import styles from "./AIPreAnnotateLayout.module.css";

export default function AIPreAnnotateLayout() {
  const { pathname } = useLocation();
  const isJobs = pathname.endsWith("/jobs");
  const isPipelines = pathname.endsWith("/pipelines");

  return (
    <div className={styles.layout}>
      <div className={styles.tabs}>
        <Link
          to="/ai-pre"
          className={`${styles.tab} ${!isJobs && !isPipelines ? styles.tabActive : ""}`}
        >
          执行预标
        </Link>
        <Link
          to="/ai-pre/pipelines"
          className={`${styles.tab} ${isPipelines ? styles.tabActive : ""}`}
        >
          编排库
        </Link>
        <Link to="/ai-pre/jobs" className={`${styles.tab} ${isJobs ? styles.tabActive : ""}`}>
          完整历史
        </Link>
      </div>
      <Outlet />
    </div>
  );
}
