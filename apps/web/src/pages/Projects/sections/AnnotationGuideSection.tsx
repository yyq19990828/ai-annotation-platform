// v0.10.13 · E1 · 项目标注指引（CVAT-style Markdown guide + asset 上传）。
//
// 编辑模式: CodeMirror 6 MarkdownEditor (dynamic import 避免污染首屏 bundle).
// 预览模式: GuideMarkdownView (react-markdown + remark-gfm + guide-asset:KEY 签名 URL 解析).
// 拖拽 / 粘贴图片走 POST /projects/{id}/guide-assets/upload-init -> PUT -> upload-complete,
// 完成后把 ![alt](guide-asset:KEY) 注入编辑器光标位置.

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useToastStore } from "@/components/ui/Toast";
import { useUpdateProject } from "@/hooks/useProjects";
import { useGuideAssets } from "@/hooks/useGuideAssets";
import { GuideMarkdownView } from "@/components/markdown/GuideMarkdownView";
import type { GuideAssetEntry, ProjectResponse } from "@/api/projects";
import styles from "./AnnotationGuideSection.module.css";

const MarkdownEditor = lazy(() =>
  import("@/components/markdown/MarkdownEditor").then((m) => ({ default: m.MarkdownEditor })),
);

type Mode = "edit" | "preview";

export function AnnotationGuideSection({ project }: { project: ProjectResponse }) {
  const pushToast = useToastStore((s) => s.push);
  const update = useUpdateProject(project.id);
  const { uploadAsset, deleteAsset, signAsset } = useGuideAssets(project.id);

  // 后端 ProjectOut 已强类型, 但 codegen 未重跑前, annotation_guide / guide_assets 走宽松断言.
  const initialMarkdown = (project as unknown as { annotation_guide?: string | null }).annotation_guide ?? "";
  const initialAssets =
    ((project as unknown as { guide_assets?: GuideAssetEntry[] }).guide_assets ?? []);

  const [mode, setMode] = useState<Mode>("edit");
  const [draft, setDraft] = useState<string>(initialMarkdown);
  const [assets, setAssets] = useState<GuideAssetEntry[]>(initialAssets);

  const dirty = draft !== initialMarkdown;

  // 项目切换时同步.
  useEffect(() => {
    setDraft(initialMarkdown);
    setAssets(initialAssets);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const handleSave = useCallback(() => {
    update.mutate(
      { annotation_guide: draft },
      {
        onSuccess: () => pushToast({ msg: "已保存标注指引", kind: "success" }),
        onError: () => pushToast({ msg: "保存失败", kind: "warning" }),
      },
    );
  }, [draft, pushToast, update]);

  const handleUpload = useCallback(
    async (file: File) => {
      const result = await uploadAsset(file);
      // upload-complete 已 append 到后端 guide_assets, 这里乐观更新本地视图.
      // 严格起见可以 invalidate query, 但 useUpdateProject onSuccess 已挂.
      setAssets((prev) => [
        ...prev,
        {
          key: result.src.replace(/^guide-asset:/, ""),
          original_name: file.name,
          content_type: file.type,
          size: file.size,
          uploaded_at: new Date().toISOString(),
        },
      ]);
      return result;
    },
    [uploadAsset],
  );

  const handleDeleteAsset = useCallback(
    async (key: string) => {
      try {
        await deleteAsset(key);
        setAssets((prev) => prev.filter((a) => a.key !== key));
        pushToast({ msg: "已删除指引图片", kind: "success" });
      } catch {
        pushToast({ msg: "删除失败", kind: "warning" });
      }
    },
    [deleteAsset, pushToast],
  );

  const resolver = useMemo(() => signAsset, [signAsset]);

  return (
    <Card>
      <div className={styles.body}>
        <h3 className={styles.title}>标注指引（CVAT-style Markdown）</h3>
        <p className={styles.description}>
          支持 Markdown 与 GFM 表格；拖拽 / 粘贴图片自动上传为项目资源。
          工作台首次进入会自动展开「📖 指引」浮层让标注员阅读一次。
        </p>

        <div className={styles.tabs} role="tablist">
          <button
            role="tab"
            type="button"
            aria-selected={mode === "edit"}
            className={`${styles.tabBtn} ${mode === "edit" ? styles.tabBtnActive : ""}`}
            onClick={() => setMode("edit")}
            data-testid="guide-tab-edit"
          >
            编辑
          </button>
          <button
            role="tab"
            type="button"
            aria-selected={mode === "preview"}
            className={`${styles.tabBtn} ${mode === "preview" ? styles.tabBtnActive : ""}`}
            onClick={() => setMode("preview")}
            data-testid="guide-tab-preview"
          >
            预览
          </button>
        </div>

        {mode === "edit" ? (
          <Suspense fallback={<div className={styles.previewPlaceholder}>编辑器加载中…</div>}>
            <MarkdownEditor
              value={draft}
              onChange={setDraft}
              onUploadImage={handleUpload}
              placeholder="# 标注指引\n请描述类别定义、易混淆边界、典型反例…"
            />
          </Suspense>
        ) : draft.trim() ? (
          <GuideMarkdownView content={draft} resolveAssetUrl={resolver} />
        ) : (
          <div className={styles.previewPlaceholder}>暂无内容</div>
        )}

        {assets.length > 0 && (
          <>
            <p className={styles.description}>已上传图片资源</p>
            <ul className={styles.assetList} data-testid="guide-asset-list">
              {assets.map((a) => (
                <li className={styles.assetItem} key={a.key}>
                  <span title={a.key}>{a.original_name}</span>
                  <span className={styles.assetSize}>
                    {(a.size / 1024).toFixed(1)} KB
                  </span>
                  <button type="button" onClick={() => void handleDeleteAsset(a.key)}>
                    删除
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className={styles.actions}>
          {update.isPending && <span className={styles.savingHint}>保存中…</span>}
          <Button onClick={handleSave} disabled={!dirty || update.isPending}>
            保存
          </Button>
        </div>
      </div>
    </Card>
  );
}
