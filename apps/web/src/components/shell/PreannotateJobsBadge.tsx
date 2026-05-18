/**
 * v0.9.8 · Topbar 全局预标 job 徽章.
 *
 * 紫色徽章显示 in-progress job 数, 0 时不渲染. 点击展开 popover 列每个 job
 * (项目名 / 进度 / 跳转链接), 让 admin 跑完后切到别处也能看到。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Icon } from "@/components/ui/Icon";
import { useGlobalPreannotationJobs } from "@/hooks/useGlobalPreannotationJobs";
import styles from "./PreannotateJobsBadge.module.css";

function JobProgressFill({ pct }: { pct: number }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    ref.current?.style.setProperty("--preannotate-job-progress", `${pct}%`);
  }, [pct]);

  return <div ref={ref} className={styles.progressFill} />;
}

export function PreannotateJobsBadge() {
  const { runningJobs } = useGlobalPreannotationJobs();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const sorted = useMemo(
    () => [...runningJobs].sort((a, b) => b.receivedAt - a.receivedAt),
    [runningJobs],
  );

  if (runningJobs.length === 0) return null;

  const jumpToProject = (projectId: string) => {
    setOpen(false);
    navigate(`/ai-pre?project_id=${projectId}`);
  };

  return (
    <div className={styles.root}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={`${runningJobs.length} 个预标 job 进行中`}
        className={styles.trigger}
      >
        <Icon name="sparkles" size={12} />
        <span>{runningJobs.length}</span>
      </button>

      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            className={styles.backdrop}
          />
          <div
            role="dialog"
            aria-label="预标进行中"
            className={styles.panel}
          >
            <div className={styles.panelTitle}>
              预标进行中 ({runningJobs.length})
            </div>
            {sorted.map((j) => {
              const pct = j.total > 0 ? Math.round((j.current / j.total) * 100) : 0;
              return (
                <button
                  key={j.job_id}
                  type="button"
                  onClick={() => jumpToProject(j.project_id)}
                  className={styles.jobButton}
                >
                  <div className={styles.jobHeader}>
                    <span className={styles.jobName}>
                      {j.project_name ?? j.project_id.slice(0, 8)}
                    </span>
                    <span className={styles.jobProgressText}>
                      {j.current}/{j.total} · {pct}%
                    </span>
                  </div>
                  <div className={styles.progressTrack}>
                    <JobProgressFill pct={pct} />
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
