// v0.10.13 · E1 · 工作台标注指引浮层.
//
// 行为:
// - 项目 annotation_guide 为空 / null → 整个 panel 不渲染.
// - localStorage 按用户、项目和指南版本隔离；首次进入自动展开并写入阅读标记.
// - 用户手动折叠后保存当前指南版本的折叠状态，后续保持折叠.

import { useEffect, useMemo, useRef, useState } from "react";
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
  const { signAsset } = useGuideAssets(projectId);
  const { markGuideRead } = useOnboardingProjectState(projectId, version);
  const guideReadEffectKey = useRef<string | null>(null);

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
      return;
    }
    setOpen(
      !(isGuideSeen(userId, projectId, version) && isGuideCollapsed(userId, projectId, version)),
    );
  }, [projectId, trimmed, userId, version]);

  // 首次自动展开时立即写入 seen 标记, 防止刷新后再次自动展开打扰用户.
  useEffect(() => {
    if (!trimmed) return;
    if (typeof window === "undefined") return;
    const effectKey = `${userId ?? "anonymous"}:${projectId}:${version}`;
    if (guideReadEffectKey.current === effectKey) return;
    guideReadEffectKey.current = effectKey;
    if (!isGuideSeen(userId, projectId, version)) {
      markGuideSeen(userId, projectId, version);
    }
    markGuideRead();
  }, [markGuideRead, projectId, trimmed, userId, version]);

  const handleToggle = () => {
    setOpen((prev) => {
      const next = !prev;
      markGuideCollapsed(userId, projectId, version, !next);
      return next;
    });
  };

  const resolver = useMemo(() => signAsset, [signAsset]);

  if (!trimmed) return null;

  return (
    <div
      className={`flex flex-col overflow-hidden absolute top-14 left-3 z-drawer-backdrop bg-card border border-border rounded-lg shadow-lg ${open ? "w-80 max-h-[70vh]" : "w-auto max-h-none"}`}
      role="region"
      aria-label="标注指引"
      data-testid="wb-guide-panel"
    >
      <div
        className="flex items-center gap-1.5 px-3 py-2 border-b border-border bg-muted cursor-pointer select-none"
        onClick={handleToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleToggle();
          }
        }}
      >
        <Icon name="book" size={14} />
        <span className="text-sm font-semibold text-foreground">标注指引</span>
        <button
          type="button"
          className="ml-auto bg-transparent border-0 text-muted-foreground cursor-pointer px-1.5 py-0.5 text-sm"
          aria-label={open ? "折叠" : "展开"}
        >
          {open ? "▾" : "▸"}
        </button>
      </div>
      {open && (
        <div className="px-3.5 py-3 overflow-auto flex-1 min-h-0">
          <GuideMarkdownView content={trimmed} resolveAssetUrl={resolver} />
        </div>
      )}
    </div>
  );
}
