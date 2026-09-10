import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/Card";
import { useToastStore } from "@/components/ui/Toast";
import { useUpdateProject } from "@/hooks/useProjects";
import { useUnsavedWarning } from "@/hooks/useUnsavedWarning";
import { useGuideAssets } from "@/hooks/useGuideAssets";
import { ANNOTATION_GUIDE_STARTER } from "@/components/markdown/markdownGuideStarter";
import type { GuideAssetEntry, ProjectResponse, ProjectUpdatePayload } from "@/api/projects";

const DESCRIPTION_CLASS = "m-0 text-xs leading-relaxed text-muted-foreground";
const PLACEHOLDER_CLASS =
  "rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground";
const AUTO_SAVE_DELAY_MS = 1000;

const MarkdownEditor = lazy(() =>
  import("@/components/markdown/MarkdownEditor").then((module) => ({
    default: module.MarkdownEditor,
  })),
);

type SaveStatus = "saved" | "pending" | "saving" | "failed";
type SaveMutation = (payload: ProjectUpdatePayload) => Promise<unknown>;

interface SaveRequest {
  epoch: number;
  revision: number;
  content: string;
  mutateAsync: SaveMutation;
}

function getSaveErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "网络或权限错误";
}

export function AnnotationGuideSection({ project }: { project: ProjectResponse }) {
  return <AnnotationGuideProjectBody key={project.id} project={project} />;
}

function AnnotationGuideProjectBody({ project }: { project: ProjectResponse }) {
  const pushToast = useToastStore((state) => state.push);
  const update = useUpdateProject(project.id);
  const updateMutateAsync = update.mutateAsync;
  const { uploadAsset, deleteAsset, resolveImage } = useGuideAssets(project.id);

  const initialMarkdown =
    (project as unknown as { annotation_guide?: string | null }).annotation_guide ?? "";
  const initialAssets = useMemo(
    () => (project as unknown as { guide_assets?: GuideAssetEntry[] | null }).guide_assets ?? [],
    [project],
  );

  const [draft, setDraft] = useState(initialMarkdown);
  const [savedMarkdown, setSavedMarkdown] = useState(initialMarkdown);
  const [assets, setAssets] = useState<GuideAssetEntry[]>(initialAssets);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);

  const draftRef = useRef(initialMarkdown);
  const savedMarkdownRef = useRef(initialMarkdown);
  const revisionRef = useRef(0);
  const projectEpochRef = useRef(0);
  const projectIdRef = useRef(project.id);
  const activeSaveRef = useRef<SaveRequest | null>(null);
  const queuedSaveRef = useRef<SaveRequest | null>(null);
  const drainingRef = useRef(false);
  const drainPromiseRef = useRef<Promise<void> | null>(null);
  const autoSaveTimerRef = useRef<number | null>(null);
  const explicitSaveTimerRef = useRef<number | null>(null);
  const ownerActiveRef = useRef(false);
  const statusRef = useRef<SaveStatus>("saved");

  const setStatus = useCallback((next: SaveStatus) => {
    if (!ownerActiveRef.current) return;
    statusRef.current = next;
    setSaveStatus(next);
  }, []);

  const mutateAsync = useCallback<SaveMutation>(
    (payload) => updateMutateAsync(payload),
    [updateMutateAsync],
  );

  const cancelAutoSave = useCallback(() => {
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
  }, []);

  // The server can refresh the same project after a successful mutation. It
  // may update a clean form, but it must never clobber an active local draft.
  useEffect(() => {
    if (projectIdRef.current !== project.id) {
      projectIdRef.current = project.id;
      projectEpochRef.current += 1;
      revisionRef.current += 1;
      queuedSaveRef.current = null;
      draftRef.current = initialMarkdown;
      savedMarkdownRef.current = initialMarkdown;
      setDraft(initialMarkdown);
      setSavedMarkdown(initialMarkdown);
      setAssets(initialAssets);
      setSaveError(null);
      setStatus("saved");
      return;
    }

    if (
      draftRef.current === savedMarkdownRef.current &&
      savedMarkdownRef.current !== initialMarkdown
    ) {
      draftRef.current = initialMarkdown;
      savedMarkdownRef.current = initialMarkdown;
      setDraft(initialMarkdown);
      setSavedMarkdown(initialMarkdown);
      setSaveError(null);
      setStatus("saved");
    }
  }, [initialAssets, initialMarkdown, project.id, setStatus]);

  useUnsavedWarning(draft !== savedMarkdown || saveStatus !== "saved");

  const drainSaveQueue = useCallback((): Promise<void> => {
    if (drainingRef.current) return drainPromiseRef.current ?? Promise.resolve();

    drainingRef.current = true;
    const drain = (async () => {
      try {
        while (queuedSaveRef.current) {
          const request = queuedSaveRef.current;
          queuedSaveRef.current = null;

          if (request.epoch !== projectEpochRef.current) continue;
          activeSaveRef.current = request;
          setStatus("saving");

          let failure: unknown = null;
          try {
            await request.mutateAsync({ annotation_guide: request.content });
          } catch (error: unknown) {
            failure = error;
          }
          activeSaveRef.current = null;

          if (request.epoch !== projectEpochRef.current) continue;

          if (failure === null) {
            // A response confirms the content it saved even when the user has
            // edited again. Compare against the current draft only after
            // advancing this baseline, otherwise A -> B -> A can lose its
            // queued save when B resolves.
            savedMarkdownRef.current = request.content;
            if (ownerActiveRef.current) {
              setSavedMarkdown(request.content);
              setSaveError(null);
            }

            const currentDraft = draftRef.current;
            if (currentDraft !== request.content) {
              const queued = queuedSaveRef.current as SaveRequest | null;
              if (queued === null && autoSaveTimerRef.current === null) {
                queuedSaveRef.current = {
                  epoch: request.epoch,
                  revision: revisionRef.current,
                  content: currentDraft,
                  mutateAsync,
                };
              } else if (
                queued &&
                (queued.epoch !== request.epoch || queued.content !== currentDraft)
              ) {
                queuedSaveRef.current =
                  autoSaveTimerRef.current === null
                    ? {
                        epoch: request.epoch,
                        revision: revisionRef.current,
                        content: currentDraft,
                        mutateAsync,
                      }
                    : null;
              }
              if (ownerActiveRef.current) {
                setStatus(queuedSaveRef.current ? "saving" : "pending");
              }
            } else {
              cancelAutoSave();
              if (ownerActiveRef.current) setStatus("saved");
            }
            continue;
          }

          // If a newer explicit request is already waiting, let it decide the
          // final state. Otherwise retain the draft and expose a retryable
          // failure.
          if (queuedSaveRef.current) continue;
          if (ownerActiveRef.current) {
            setSaveError(getSaveErrorMessage(failure));
            setStatus("failed");
            pushToast({ msg: "标注指引保存失败，可重试", kind: "warning" });
          }
        }
      } finally {
        drainingRef.current = false;
        drainPromiseRef.current = null;
      }
    })();

    drainPromiseRef.current = drain;
    return drain;
  }, [cancelAutoSave, mutateAsync, pushToast, setStatus]);

  const enqueueSave = useCallback((): Promise<void> => {
    const content = draftRef.current;
    const epoch = projectEpochRef.current;
    const active = activeSaveRef.current;
    const queued = queuedSaveRef.current;

    if (active?.epoch === epoch && active.content === content) {
      return drainPromiseRef.current ?? Promise.resolve();
    }
    if (queued?.epoch === epoch && queued.content === content) {
      return drainPromiseRef.current ?? Promise.resolve();
    }
    if (!active && !queued && content === savedMarkdownRef.current) {
      setStatus("saved");
      return Promise.resolve();
    }

    queuedSaveRef.current = {
      epoch,
      revision: revisionRef.current,
      content,
      mutateAsync,
    };
    if (ownerActiveRef.current) setSaveError(null);
    setStatus("saving");
    return drainSaveQueue();
  }, [drainSaveQueue, mutateAsync, setStatus]);

  const scheduleAutoSave = useCallback(() => {
    cancelAutoSave();
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      void enqueueSave();
    }, AUTO_SAVE_DELAY_MS);
  }, [cancelAutoSave, enqueueSave]);

  const handleDraftChange = useCallback(
    (next: string) => {
      draftRef.current = next;
      revisionRef.current += 1;
      setDraft(next);
      setSaveError(null);

      const epoch = projectEpochRef.current;
      const queued = queuedSaveRef.current;
      if (queued && (queued.epoch !== epoch || queued.content !== next)) {
        queuedSaveRef.current = null;
      }
      const active = activeSaveRef.current;
      const queuedAfterChange = queuedSaveRef.current;
      const hasOutstandingSave = active?.epoch === epoch || queuedAfterChange?.epoch === epoch;
      if (next === savedMarkdownRef.current && !hasOutstandingSave) {
        cancelAutoSave();
        setStatus("saved");
        return;
      }

      const requestAlreadyHasDraft =
        (active?.epoch === epoch && active.content === next) ||
        (queuedAfterChange?.epoch === epoch && queuedAfterChange.content === next);
      if (requestAlreadyHasDraft) {
        cancelAutoSave();
        setStatus("saving");
      } else {
        scheduleAutoSave();
        setStatus(hasOutstandingSave ? "saving" : "pending");
      }
    },
    [cancelAutoSave, scheduleAutoSave, setStatus],
  );

  const handleAutoSave = useCallback(() => {
    cancelAutoSave();
    void enqueueSave();
  }, [cancelAutoSave, enqueueSave]);

  const handleExplicitSave = useCallback(() => {
    cancelAutoSave();
    if (explicitSaveTimerRef.current !== null) {
      window.clearTimeout(explicitSaveTimerRef.current);
    }
    // A table cell is a nested Lexical editor. Its blur handler flushes the
    // cell into the parent editor before MDXEditor publishes the new Markdown.
    // Read the draft on the next task so an explicit save cannot capture the
    // pre-flush value.
    explicitSaveTimerRef.current = window.setTimeout(() => {
      explicitSaveTimerRef.current = null;
      void enqueueSave();
    }, 0);
  }, [cancelAutoSave, enqueueSave]);

  const retireFlushRef = useRef<() => void>(() => undefined);
  retireFlushRef.current = () => {
    cancelAutoSave();
    if (explicitSaveTimerRef.current !== null) {
      window.clearTimeout(explicitSaveTimerRef.current);
      explicitSaveTimerRef.current = null;
    }
    void enqueueSave();
  };

  useEffect(() => {
    ownerActiveRef.current = true;
    return () => {
      ownerActiveRef.current = false;
      retireFlushRef.current();
    };
  }, []);

  const handleUpload = useCallback(
    async (file: File) => {
      const epoch = projectEpochRef.current;
      const projectId = project.id;
      const result = await uploadAsset(file);
      if (epoch !== projectEpochRef.current || projectId !== projectIdRef.current) {
        throw new Error("项目已切换，上传结果已丢弃");
      }
      setAssets((previous) => [
        ...previous,
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
    [project.id, uploadAsset],
  );

  const handleDeleteAsset = useCallback(
    async (key: string) => {
      const epoch = projectEpochRef.current;
      try {
        await deleteAsset(key);
        if (epoch !== projectEpochRef.current) return;
        setAssets((previous) => previous.filter((asset) => asset.key !== key));
        pushToast({ msg: "已删除指引图片", kind: "success" });
      } catch (error: unknown) {
        pushToast({ msg: getSaveErrorMessage(error), kind: "warning" });
      }
    },
    [deleteAsset, pushToast],
  );

  const handleStarter = useCallback(() => {
    if (draftRef.current.trim()) return;
    handleDraftChange(ANNOTATION_GUIDE_STARTER);
  }, [handleDraftChange]);

  const saveButtonLabel = saveStatus === "failed" ? "重试保存" : "保存";

  return (
    <Card>
      <div className="flex flex-col gap-3 px-4 py-4">
        <h3 className="m-0 text-md font-semibold">标注指引</h3>
        <p className={DESCRIPTION_CLASS}>
          支持可视化 Markdown、源码和 GFM 表格；拖拽或粘贴图片会上传到当前项目资源。
          标注员可通过工作台顶栏的「标注指引」按钮打开阅读窗口。 停止输入后自动保存，也可手动保存。
        </p>

        <Suspense fallback={<div className={PLACEHOLDER_CLASS}>编辑器加载中…</div>}>
          <MarkdownEditor
            key={project.id}
            value={draft}
            onChange={handleDraftChange}
            onUploadImage={handleUpload}
            onBlur={handleAutoSave}
            documentId={project.id}
            label="标注指引编辑器"
            variant="document"
            resolveImage={resolveImage}
            imageScope={project.id}
            placeholder="输入类别定义、易混淆边界和典型反例…"
          />
        </Suspense>

        {!draft.trim() && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-border px-3 py-2">
            <span className="text-xs text-muted-foreground">
              从类别定义、边界规则和复核清单开始。
            </span>
            <button
              type="button"
              className="cursor-pointer rounded-md border border-border bg-transparent px-2.5 py-1 text-xs text-foreground hover:bg-accent"
              onClick={handleStarter}
              data-testid="guide-starter"
            >
              插入指引模板
            </button>
          </div>
        )}

        {assets.length > 0 && (
          <>
            <p className={DESCRIPTION_CLASS}>已上传图片资源</p>
            <ul
              className="m-0 max-h-[200px] list-none overflow-auto rounded-md border border-border p-0"
              data-testid="guide-asset-list"
            >
              {assets.map((asset) => (
                <li
                  className="flex items-center gap-2 border-b border-border px-2.5 py-1.5 text-xs last:border-b-0"
                  key={asset.key}
                >
                  <span title={asset.key}>{asset.original_name}</span>
                  <span className="text-muted-foreground">{(asset.size / 1024).toFixed(1)} KB</span>
                  <button
                    type="button"
                    onClick={() => void handleDeleteAsset(asset.key)}
                    className="ml-auto cursor-pointer appearance-none rounded-sm border border-border bg-transparent px-2 py-0.5 text-xs text-status-danger"
                  >
                    删除
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span
            className="text-xs text-muted-foreground"
            role="status"
            aria-live="polite"
            data-testid="guide-save-status"
          >
            {saveStatus === "saving"
              ? "保存中…"
              : saveStatus === "pending"
                ? "等待自动保存"
                : saveStatus === "failed"
                  ? `保存失败：${saveError ?? "请重试"}`
                  : "已保存"}
          </span>
          <button
            type="button"
            onClick={handleExplicitSave}
            disabled={saveStatus === "saving"}
            className="cursor-pointer rounded-md border border-border bg-transparent px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="guide-save"
          >
            {saveButtonLabel}
          </button>
        </div>
      </div>
    </Card>
  );
}
