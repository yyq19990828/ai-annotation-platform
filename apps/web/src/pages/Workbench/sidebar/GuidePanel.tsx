// v0.10.13 · E1 · 工作台标注指引浮层.
//
// 行为:
// - 项目 annotation_guide 为空 / null → 整个 panel 不渲染.
// - localStorage 按用户、项目和指南版本隔离；首次进入自动展开，需用户明确确认阅读.
// - 用户手动折叠后保存当前指南版本的折叠状态，后续保持折叠.

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { GuideMarkdownView } from "@/components/markdown/GuideMarkdownView";
import { useGuideAssets } from "@/hooks/useGuideAssets";
import { useOnboardingProjectState } from "@/hooks/useOnboardingProjectState";
import {
  annotationGuideVersion,
  isGuideCollapsed,
  isGuideSeen,
  markGuideSeen,
  markGuideCollapsed,
} from "@/utils/annotationGuide";

interface GuidePanelProps {
  projectId: string;
  userId?: string | null;
  guideVersion?: string;
  /** 项目级 Markdown 原文; null/空字符串 → panel 不渲染. */
  content: string | null | undefined;
}

export function GuidePanel({ projectId, userId, guideVersion, content }: GuidePanelProps) {
  const trimmed = (content ?? "").trim();
  const version = guideVersion ?? annotationGuideVersion(content);
  const { resolveImage } = useGuideAssets(projectId);
  const {
    markGuideRead,
    retry,
    saveError,
    isSaving,
    guideRead: serverGuideRead,
  } = useOnboardingProjectState(projectId, version);
  const [confirmed, setConfirmed] = useState(() => isGuideSeen(userId, projectId, version));

  const [open, setOpen] = useState<boolean>(() => {
    if (!trimmed) return false;
    const seen = isGuideSeen(userId, projectId, version);
    const collapsed = isGuideCollapsed(userId, projectId, version);
    return !(seen && collapsed);
  });

  // The workbench shell can keep this panel mounted while switching projects.
  // Re-read the scoped state so one project's collapsed guide cannot leak into
  // another project's guide.
  useEffect(() => {
    if (!trimmed) {
      setOpen(false);
      setConfirmed(false);
      return;
    }
    setConfirmed(isGuideSeen(userId, projectId, version));
    setOpen(
      !(isGuideSeen(userId, projectId, version) && isGuideCollapsed(userId, projectId, version)),
    );
  }, [projectId, trimmed, userId, version]);

  const guideRead = serverGuideRead || confirmed || isGuideSeen(userId, projectId, version);

  const confirmRead = async () => {
    const ok = await markGuideRead();
    if (ok) {
      markGuideSeen(userId, projectId, version);
      setConfirmed(true);
    }
  };

  const retryRead = async () => {
    const ok = await retry();
    if (ok) {
      markGuideSeen(userId, projectId, version);
      setConfirmed(true);
    }
  };

  const handleToggle = () => {
    setOpen((prev) => {
      const next = !prev;
      markGuideCollapsed(userId, projectId, version, !next);
      return next;
    });
  };

  if (!trimmed) return null;

  return (
    <div
      className={`flex flex-col overflow-hidden absolute top-14 left-3 z-drawer-backdrop bg-card border border-border rounded-lg shadow-lg ${open ? "w-80 max-h-[70vh]" : "w-auto max-h-none"}`}
      role="region"
      aria-label="标注指引"
      data-testid="wb-guide-panel"
    >
      <button
        type="button"
        className="flex items-center gap-1.5 px-3 py-2 border-0 border-b border-border bg-muted cursor-pointer text-left"
        onClick={handleToggle}
        aria-expanded={open}
        aria-label={open ? "折叠标注指引" : "展开标注指引"}
      >
        <Icon name="book" size={14} />
        <span className="text-sm font-semibold text-foreground">标注指引</span>
        <Icon
          name={open ? "chevDown" : "chevRight"}
          size={14}
          className="ml-auto text-muted-foreground"
        />
      </button>
      {open && (
        <div className="px-3.5 py-3 overflow-auto flex-1 min-h-0">
          <GuideMarkdownView content={trimmed} resolveImage={resolveImage} imageScope={projectId} />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
            <span className="text-xs text-muted-foreground">
              {guideRead ? "已确认阅读当前版本" : "阅读完整指引后确认，指南更新后需重新确认"}
            </span>
            <button
              type="button"
              className="rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => void confirmRead()}
              disabled={guideRead || isSaving}
            >
              {isSaving ? "保存中…" : guideRead ? "已确认阅读" : "确认已阅读"}
            </button>
          </div>
          {saveError && (
            <div
              role="alert"
              className="mt-2 flex items-center justify-between gap-2 text-xs text-status-danger"
            >
              <span>{saveError}</span>
              <button
                type="button"
                className="shrink-0 underline"
                onClick={() => void retryRead()}
                disabled={isSaving}
              >
                重试
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
