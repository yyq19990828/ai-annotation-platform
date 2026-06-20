// v0.10.13 · E1 · 项目标注指引（CVAT-style Markdown guide + asset 上传）。
//
// 编辑模式: CodeMirror 6 MarkdownEditor (dynamic import 避免污染首屏 bundle).
// 预览模式: GuideMarkdownView (react-markdown + remark-gfm + guide-asset:KEY 签名 URL 解析).
// 拖拽 / 粘贴图片走 POST /projects/{id}/guide-assets/upload-init -> PUT -> upload-complete,
// 完成后把 ![alt](guide-asset:KEY) 注入编辑器光标位置.

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { useToastStore } from "@/components/ui/Toast";
import { useUpdateProject } from "@/hooks/useProjects";
import { useUnsavedWarning } from "@/hooks/useUnsavedWarning";
import { useGuideAssets } from "@/hooks/useGuideAssets";
import { GuideMarkdownView } from "@/components/markdown/GuideMarkdownView";
import type { GuideAssetEntry, ProjectResponse } from "@/api/projects";

const DESCRIPTION_CLASS = "m-0 text-xs leading-relaxed text-muted-foreground";
const TAB_BTN_BASE =
  "-mb-px cursor-pointer appearance-none border-0 border-b-2 border-b-transparent bg-transparent px-3 py-1.5 text-[13px] text-muted-foreground";
const PREVIEW_PLACEHOLDER_CLASS =
  "rounded-md border border-dashed border-border p-6 text-center text-[13px] text-muted-foreground";

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

  // blur 自动保存兜不住「未失焦直接关 tab / 刷新」的大段输入，补浏览器离开提示。
  useUnsavedWarning(draft !== initialMarkdown);

  // 项目切换时同步.
  useEffect(() => {
    setDraft(initialMarkdown);
    setAssets(initialAssets);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  // 失焦自动保存：内容有变更才提交。失败弹 toast，成功静默（切到预览 tab
  // 会让编辑器失焦，从而触发保存）。
  const handleAutoSave = useCallback(() => {
    if (draft === initialMarkdown) return;
    update.mutate(
      { annotation_guide: draft },
      { onError: () => pushToast({ msg: "保存失败", kind: "warning" }) },
    );
  }, [draft, initialMarkdown, pushToast, update]);

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
      <div className="flex flex-col gap-3 px-[18px] py-4">
        <h3 className="m-0 text-[15px] font-semibold">标注指引（CVAT-style Markdown）</h3>
        <p className={DESCRIPTION_CLASS}>
          支持 Markdown 与 GFM 表格；拖拽 / 粘贴图片自动上传为项目资源。
          工作台首次进入会自动展开「📖 指引」浮层让标注员阅读一次。
        </p>

        <div className="flex gap-1 border-b border-border" role="tablist">
          <button
            role="tab"
            type="button"
            aria-selected={mode === "edit"}
            className={`${TAB_BTN_BASE} ${mode === "edit" ? "border-b-brand text-foreground" : ""}`}
            onClick={() => setMode("edit")}
            data-testid="guide-tab-edit"
          >
            编辑
          </button>
          <button
            role="tab"
            type="button"
            aria-selected={mode === "preview"}
            className={`${TAB_BTN_BASE} ${mode === "preview" ? "border-b-brand text-foreground" : ""}`}
            onClick={() => setMode("preview")}
            data-testid="guide-tab-preview"
          >
            预览
          </button>
        </div>

        {mode === "edit" ? (
          <Suspense fallback={<div className={PREVIEW_PLACEHOLDER_CLASS}>编辑器加载中…</div>}>
            <MarkdownEditor
              value={draft}
              onChange={setDraft}
              onUploadImage={handleUpload}
              onBlur={handleAutoSave}
              placeholder="# 标注指引\n请描述类别定义、易混淆边界、典型反例…"
            />
          </Suspense>
        ) : draft.trim() ? (
          <GuideMarkdownView content={draft} resolveAssetUrl={resolver} />
        ) : (
          <div className={PREVIEW_PLACEHOLDER_CLASS}>暂无内容</div>
        )}

        {assets.length > 0 && (
          <>
            <p className={DESCRIPTION_CLASS}>已上传图片资源</p>
            <ul className="m-0 max-h-[200px] list-none overflow-auto rounded-md border border-border p-0" data-testid="guide-asset-list">
              {assets.map((a) => (
                <li className="flex items-center gap-2 border-b border-border px-2.5 py-1.5 text-xs last:border-b-0" key={a.key}>
                  <span title={a.key}>{a.original_name}</span>
                  <span className="text-muted-foreground">
                    {(a.size / 1024).toFixed(1)} KB
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleDeleteAsset(a.key)}
                    className="ml-auto cursor-pointer appearance-none rounded-sm border border-border bg-transparent px-2 py-0.5 text-[11px] text-status-danger"
                  >
                    删除
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="flex justify-end gap-2">
          {update.isPending && <span className="text-xs text-muted-foreground">保存中…</span>}
        </div>
      </div>
    </Card>
  );
}
