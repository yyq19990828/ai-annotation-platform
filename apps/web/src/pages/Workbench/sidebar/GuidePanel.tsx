// v0.10.13 · E1 · 工作台标注指引浮层.
//
// 行为:
// - 项目 annotation_guide 为空 / null → 整个 panel 不渲染.
// - localStorage `wb:guide-seen:{projectId}` 不存在 → 首次自动展开 + 写入标记.
// - 用户手动折叠后写入 localStorage `wb:guide-collapsed:{projectId}`, 后续保持折叠.

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { GuideMarkdownView } from "@/components/markdown/GuideMarkdownView";
import { useGuideAssets } from "@/hooks/useGuideAssets";
import styles from "./GuidePanel.module.css";

interface GuidePanelProps {
  projectId: string;
  /** 项目级 Markdown 原文; null/空字符串 → panel 不渲染. */
  content: string | null | undefined;
}

const SEEN_KEY = (id: string) => `wb:guide-seen:${id}`;
const COLLAPSED_KEY = (id: string) => `wb:guide-collapsed:${id}`;

export function GuidePanel({ projectId, content }: GuidePanelProps) {
  const trimmed = (content ?? "").trim();
  const { signAsset } = useGuideAssets(projectId);

  const [open, setOpen] = useState<boolean>(() => {
    if (!trimmed) return false;
    if (typeof window === "undefined") return false;
    const seen = window.localStorage.getItem(SEEN_KEY(projectId));
    const collapsed = window.localStorage.getItem(COLLAPSED_KEY(projectId));
    if (seen && collapsed === "1") return false;
    return true;
  });

  // 首次自动展开时立即写入 seen 标记, 防止刷新后再次自动展开打扰用户.
  useEffect(() => {
    if (!trimmed) return;
    if (typeof window === "undefined") return;
    if (!window.localStorage.getItem(SEEN_KEY(projectId))) {
      window.localStorage.setItem(SEEN_KEY(projectId), String(Date.now()));
    }
  }, [projectId, trimmed]);

  const handleToggle = () => {
    setOpen((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(COLLAPSED_KEY(projectId), next ? "0" : "1");
      }
      return next;
    });
  };

  const resolver = useMemo(() => signAsset, [signAsset]);

  if (!trimmed) return null;

  return (
    <div
      className={`${styles.root} ${open ? "" : styles.collapsed}`}
      role="region"
      aria-label="标注指引"
      data-testid="wb-guide-panel"
    >
      <div
        className={styles.header}
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
        <span className={styles.title}>标注指引</span>
        <button type="button" className={styles.collapseBtn} aria-label={open ? "折叠" : "展开"}>
          {open ? "▾" : "▸"}
        </button>
      </div>
      {open && (
        <div className={styles.body}>
          <GuideMarkdownView content={trimmed} resolveAssetUrl={resolver} />
        </div>
      )}
    </div>
  );
}
