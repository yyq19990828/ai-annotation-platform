/**
 * v0.9.7 · /ai-pre 文本批量预标 — 外壳 (信息架构重构后).
 *
 * 旧版本 478 行单文件 inline style 拆成 6 个子组件:
 *   PreannotateStepper / ProjectBatchPicker / PromptComposer /
 *   OutputModeSelector / RunPanel / HistoryTable.
 *
 * 本文件只负责状态编排 (项目→batch 联动 + 草稿持久化 + WS 进度) 与 stepper 状态
 * 推导, 不做视觉细节 — 视觉/交互由子组件持有.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { useToastStore } from "@/components/ui/Toast";
import { useProjects, useProject } from "@/hooks/useProjects";
import { useBatches } from "@/hooks/useBatches";
import { useMLBackends } from "@/hooks/useMLBackends";
import { adminPreannotateApi } from "@/api/adminPreannotate";
import {
  useTriggerPreannotation,
  usePreannotationProgress,
  type TextOutputMode,
} from "@/hooks/usePreannotation";
import { useGlobalPreannotationJobs } from "@/hooks/useGlobalPreannotationJobs";
import { aliasFrequencyApi } from "@/api/aliasFrequency";

import { PreannotateStepper, type StepDef, type StepStatus } from "./components/PreannotateStepper";
import { ProjectBatchPicker } from "./components/ProjectBatchPicker";
import { PromptComposer, type AliasEntry } from "./components/PromptComposer";
import { OutputModeSelector } from "./components/OutputModeSelector";
import { RunPanel } from "./components/RunPanel";
import { HistoryTable } from "./components/HistoryTable";
import {
  PAGE_PADDING_X,
  PAGE_PADDING_Y,
  SECTION_GAP,
  FS_XS,
  FS_SM,
  FS_XL,
} from "./styles";
import {
  readDraft,
  writeDraft,
  clearDraft,
  usePreannotateDraftAutosave,
} from "./hooks/usePreannotateDraft";

function defaultOutputMode(typeKey: string | undefined | null): TextOutputMode {
  if (typeKey === "image-det") return "box";
  if (typeKey === "image-seg") return "mask";
  return "mask";
}

export default function AIPreAnnotatePage() {
  const pushToast = useToastStore((s) => s.push);
  const navigate = useNavigate();

  const queueQ = useQuery({
    queryKey: ["admin", "preannotate-queue"],
    queryFn: () => adminPreannotateApi.queue(50),
    staleTime: 1000 * 60 * 5,
  });

  const [projectId, setProjectId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [outputMode, setOutputMode] = useState<TextOutputMode>("mask");

  const projectsQ = useProjects();
  // useProjects 返回的 ProjectResponse 字段并不严格满足 ProjectBatchPicker 的最小接口,
  // 但运行时形态一致 (display_id / name / type_label / ai_enabled / type_key); 用断言避免引入
  // 全局 type 调整连锁.
  const allProjects = (projectsQ.data ?? []) as unknown as Array<{
    id: string;
    display_id: string;
    name: string;
    type_label: string;
    ai_enabled?: boolean;
    type_key?: string;
  }>;
  const projects = useMemo(
    () => allProjects.filter((p) => p.ai_enabled),
    [allProjects],
  );
  const projectQ = useProject(projectId);
  const project = projectQ.data as unknown as {
    classes_config?: Record<string, { alias?: string | null }>;
    type_key?: string;
    ml_backend_id?: string | null;
    box_threshold?: number;
    text_threshold?: number;
  } | undefined;

  const batchesQ = useBatches(projectId, "active");
  const batches = (batchesQ.data ?? []) as unknown as Array<{
    id: string;
    display_id: string;
    name: string;
    total_tasks?: number | null;
  }>;

  const backendsQ = useMLBackends(projectId);
  const backends = (backendsQ.data ?? []) as unknown as Array<{ id: string; name: string }>;
  const boundBackend = backends.find((b) => b.id === project?.ml_backend_id) ?? null;

  /* ── alias 频率查询 (Block C) ────────────────────────────────── */
  const freqQ = useQuery({
    queryKey: ["alias-frequency", projectId],
    queryFn: () => aliasFrequencyApi.byProject(projectId),
    enabled: !!projectId,
    staleTime: 1000 * 60 * 5,
  });

  const aliases: AliasEntry[] = useMemo(() => {
    const cfg = project?.classes_config ?? {};
    const freq = freqQ.data?.frequency ?? {};
    return Object.entries(cfg)
      .map(([name, entry]) => ({
        name,
        alias: entry?.alias ?? null,
        count: freq[entry?.alias ?? ""] ?? 0,
      }))
      .filter((e): e is AliasEntry => !!e.alias)
      .sort((a, b) => b.count - a.count || a.alias.localeCompare(b.alias));
  }, [project, freqQ.data]);

  const hasAnyClassConfigured = useMemo(
    () => Object.keys(project?.classes_config ?? {}).length > 0,
    [project],
  );

  /* ── v0.9.8 · 全局预标 job 订阅 (切项目 toast 检测旧项目 in-flight job) ─ */
  const { byProject: jobsByProject } = useGlobalPreannotationJobs();

  /* ── 草稿: 切项目时把旧 prompt 推 localStorage 不丢, 加载新项目草稿 ─── */
  const prevProjectIdRef = useRef<string>("");
  useEffect(() => {
    const prev = prevProjectIdRef.current;
    if (prev && prev !== projectId && prompt.trim()) {
      writeDraft(prev, prompt);
    }
    if (projectId && projectId !== prev) {
      const next = readDraft(projectId);
      setPrompt(next);
      if (prev) {
        // v0.9.8 · 旧项目仍有 in-flight 预标 job 时优先弹警告 toast (单独一条)
        const stillRunning = jobsByProject[prev];
        if (stillRunning) {
          const prevName =
            allProjects.find((p) => p.id === prev)?.name ?? prev.slice(0, 8);
          pushToast({
            msg: `项目「${prevName}」仍在跑预标 (${stillRunning.current}/${stillRunning.total})`,
            sub: "Topbar 紫色徽章可一键回跳查看进度",
            kind: "warning",
          });
        }
        pushToast({
          msg: "已切换项目",
          sub: prev && prompt.trim() ? "旧 prompt 已存为草稿" : "草稿已恢复",
          kind: "",
        });
      }
    }
    prevProjectIdRef.current = projectId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  usePreannotateDraftAutosave(projectId || null, prompt);

  /* ── 项目切换: 重置 batch / 智能默认 outputMode ─────────────── */
  useEffect(() => {
    setBatchId("");
    setOutputMode(defaultOutputMode(project?.type_key));
  }, [project?.type_key, projectId]);

  /* ── 触发预标 + WS 进度 ──────────────────────────────────────── */
  const trigger = useTriggerPreannotation(projectId || undefined);
  const { progress, connection } = usePreannotationProgress(projectId || undefined);
  const running = progress?.status === "running";

  const canRun = !!projectId && !!batchId && !!prompt.trim() && !!boundBackend && !running;

  const onRun = () => {
    if (!boundBackend || !batchId || !prompt.trim()) return;
    trigger.mutate(
      {
        ml_backend_id: boundBackend.id,
        batch_id: batchId,
        prompt: prompt.trim(),
        output_mode: outputMode,
      },
      {
        onSuccess: (resp) => {
          pushToast({
            msg: `已排队：${resp.total_tasks ?? "?"} 张图`,
            sub: `job ${resp.job_id.slice(0, 8)}`,
            kind: "success",
          });
          clearDraft(projectId);
        },
        onError: (err) => {
          pushToast({
            msg: "触发失败",
            sub: (err as Error).message,
            kind: "error",
          });
        },
      },
    );
  };

  const onOpenWorkbench = () => {
    if (projectId && batchId) {
      navigate(`/projects/${projectId}/annotate?batch=${batchId}`);
    }
  };

  /* ── stepper 状态推导 ────────────────────────────────────────── */
  const steps: StepDef[] = useMemo(() => {
    const s1Complete = !!projectId && !!batchId && !!boundBackend;
    const s2Complete = s1Complete && !!prompt.trim();
    const s3Complete = s2Complete; // outputMode 永远有默认
    const s4Complete = progress?.status === "completed";

    const status = (
      complete: boolean,
      idx: 1 | 2 | 3 | 4,
      prevComplete: boolean,
    ): StepStatus => {
      if (complete) return "complete";
      if (idx === 1 || prevComplete) return "active";
      return "pending";
    };

    return [
      { id: 1, label: "项目+批次", anchor: "#step-project", status: status(s1Complete, 1, true) },
      {
        id: 2,
        label: "Prompt",
        anchor: "#step-prompt",
        status: status(s2Complete, 2, s1Complete),
      },
      {
        id: 3,
        label: "输出形态",
        anchor: "#step-output",
        status: status(s3Complete, 3, s2Complete),
      },
      { id: 4, label: "跑预标", anchor: "#step-run", status: status(!!s4Complete, 4, s3Complete) },
    ];
  }, [projectId, batchId, boundBackend, prompt, progress]);

  return (
    <div
      style={{
        padding: `${PAGE_PADDING_Y}px ${PAGE_PADDING_X}px`,
        display: "flex",
        flexDirection: "column",
        gap: SECTION_GAP,
      }}
    >
      <header>
        <h1 style={{ fontSize: FS_XL, fontWeight: 600, margin: 0 }}>AI 文本批量预标</h1>
        <p style={{ fontSize: FS_SM, color: "var(--color-fg-muted)", marginTop: 4 }}>
          为指定批次批量跑 SAM 文本预标。跑完后批次自动转 pre_annotated 状态，等待人工接管。
        </p>
      </header>

      <PreannotateStepper steps={steps} />

      <ProjectBatchPicker
        anchorId="step-project"
        projects={projects}
        projectsLoading={projectsQ.isLoading}
        projectId={projectId}
        onProjectChange={setProjectId}
        batches={batches}
        batchId={batchId}
        onBatchChange={setBatchId}
        boundBackend={boundBackend}
        stepBadge="Step 1"
      />

      {projectId && batchId && (
        <>
          <PromptComposer
            anchorId="step-prompt"
            stepBadge="Step 2"
            projectId={projectId}
            prompt={prompt}
            onPromptChange={setPrompt}
            onSubmit={onRun}
            canSubmit={canRun}
            aliases={aliases}
            hasAnyClassConfigured={hasAnyClassConfigured}
            boxThreshold={project?.box_threshold ?? 0.35}
            textThreshold={project?.text_threshold ?? 0.25}
          />

          <OutputModeSelector
            anchorId="step-output"
            stepBadge="Step 3"
            outputMode={outputMode}
            onChange={setOutputMode}
          />

          <RunPanel
            anchorId="step-run"
            stepBadge="Step 4"
            canRun={canRun}
            isPending={trigger.isPending}
            isRunning={running}
            progress={progress}
            connection={connection}
            onRun={onRun}
            onOpenWorkbench={onOpenWorkbench}
          />
        </>
      )}

      <HistoryTable items={queueQ.data?.items ?? []} isLoading={queueQ.isLoading} />

      {!projectId && (
        <div style={{ fontSize: FS_XS, color: "var(--color-fg-subtle)", textAlign: "center", padding: 8 }}>
          选择项目开始 · 完成后按 ⌘/Ctrl + Enter 一键跑预标
        </div>
      )}
    </div>
  );
}
