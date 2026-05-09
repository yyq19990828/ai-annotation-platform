/**
 * v0.9.12 · BUG B-17 · 项目详情面板 (多选 batch + 串/并行预标 + 已就绪 HistoryTable).
 *
 * 进入条件: ProjectCardGrid 点击某项目卡片;此面板替代主视图渲染.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { useToastStore } from "@/components/ui/Toast";
import { useProject } from "@/hooks/useProjects";
import { useBatches } from "@/hooks/useBatches";
import { useMLBackends } from "@/hooks/useMLBackends";
import {
  useTriggerPreannotation,
  type TextOutputMode,
} from "@/hooks/usePreannotation";
import { adminPreannotateApi } from "@/api/adminPreannotate";
import { aliasFrequencyApi } from "@/api/aliasFrequency";

import { TabRow } from "@/components/ui/TabRow";
import { HistoryTable } from "./HistoryTable";
import { FS_XS, FS_SM, FS_LG, SECTION_GAP } from "../styles";

const OUTPUT_MODE_TABS = ["□ 框", "○ 掩膜", "⊕ 全部"];
const OUTPUT_MODE_LABELS: Record<TextOutputMode, string> = {
  box: "□ 框",
  mask: "○ 掩膜",
  both: "⊕ 全部",
};
const OUTPUT_MODE_BY_LABEL: Record<string, TextOutputMode> = {
  "□ 框": "box",
  "○ 掩膜": "mask",
  "⊕ 全部": "both",
};

type ConcurrencyMode = "serial" | "parallel";

interface Props {
  projectId: string;
  onBack: () => void;
  /** 项目卡片传入的聚合摘要（用于头部 ml_backend chip + 并发上限）；不可省的部分会再用 hooks 拉. */
  summary?: {
    project_name: string;
    project_display_id?: string | null;
    ml_backend_id?: string | null;
    ml_backend_name?: string | null;
    ml_backend_state?: string | null;
    ml_backend_max_concurrency?: number | null;
  };
}

export function ProjectDetailPanel({ projectId, onBack, summary }: Props) {
  const pushToast = useToastStore((s) => s.push);
  const navigate = useNavigate();

  const projectQ = useProject(projectId);
  const project = projectQ.data as unknown as
    | {
        type_key?: string;
        ml_backend_id?: string | null;
        classes_config?: Record<string, { alias?: string | null }>;
      }
    | undefined;

  // v0.9.12 · 复活 v0.9.7 alias 频率排序: prompt 默认勾选项目所有 alias (按预标频率降序).
  const freqQ = useQuery({
    queryKey: ["alias-frequency", projectId],
    queryFn: () => aliasFrequencyApi.byProject(projectId),
    enabled: !!projectId,
    staleTime: 1000 * 60 * 5,
  });

  const aliases = useMemo(() => {
    const cfg = project?.classes_config ?? {};
    const freq = freqQ.data?.frequency ?? {};
    return Object.entries(cfg)
      .map(([name, entry]) => ({
        name,
        alias: entry?.alias ?? null,
        count: freq[entry?.alias ?? ""] ?? 0,
      }))
      .filter(
        (e): e is { name: string; alias: string; count: number } => !!e.alias,
      )
      .sort((a, b) => b.count - a.count || a.alias.localeCompare(b.alias));
  }, [project, freqQ.data]);

  const backendsQ = useMLBackends(projectId);
  const backends = (backendsQ.data ?? []) as unknown as Array<{ id: string; name: string }>;
  const boundBackend = backends.find((b) => b.id === project?.ml_backend_id) ?? null;

  const batchesQ = useBatches(projectId, "active");
  const batches = (batchesQ.data ?? []) as unknown as Array<{
    id: string;
    display_id: string;
    name: string;
    total_tasks?: number | null;
  }>;

  // pre_annotated 队列 (复用 /admin/preannotate-queue 端点 + 客户端按 project 过滤)
  const queueQ = useQuery({
    queryKey: ["admin", "preannotate-queue"],
    queryFn: () => adminPreannotateApi.queue(50),
    staleTime: 1000 * 30,
  });
  const projectQueue = useMemo(
    () => (queueQ.data?.items ?? []).filter((it) => it.project_id === projectId),
    [queueQ.data, projectId],
  );

  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<string>>(new Set());
  const [prompt, setPrompt] = useState("");
  const [outputMode, setOutputMode] = useState<TextOutputMode>("mask");
  const [concurrency, setConcurrency] = useState<ConcurrencyMode>("serial");
  const [running, setRunning] = useState(false);

  // 项目切换时重置选择 / 默认 outputMode / prompt
  useEffect(() => {
    setSelectedBatchIds(new Set());
    setOutputMode(
      project?.type_key === "image-det" ? "box" : "mask",
    );
    setPrompt("");
    defaultPromptAppliedRef.current = "";
  }, [projectId, project?.type_key]);

  // v0.9.12 · 复活 v0.9.7 行为: aliases 加载完且 prompt 仍空时, 默认勾选所有 alias 拼成逗号分隔
  // (按预标频率降序, 频率为 0 时按 alias 字母升序). 已手填则不覆盖. 切项目时上一段 effect 会先
  // 清 prompt + 复位 ref. 等 freqQ.isFetched 而非仅 aliases.length, 否则首屏 freq=undefined 时
  // alpha 序填进去后, freqQ 解析也不会再重排.
  const defaultPromptAppliedRef = useRef<string>("");
  useEffect(() => {
    if (!projectId) return;
    if (defaultPromptAppliedRef.current === projectId) return;
    if (!freqQ.isFetched) return;
    if (aliases.length === 0) return;
    if (prompt.trim()) {
      defaultPromptAppliedRef.current = projectId;
      return;
    }
    setPrompt(aliases.map((a) => a.alias).join(", "));
    defaultPromptAppliedRef.current = projectId;
  }, [projectId, aliases, prompt, freqQ.isFetched]);

  const trigger = useTriggerPreannotation(projectId);

  const toggleBatch = (id: string) => {
    setSelectedBatchIds((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const allSelected = batches.length > 0 && batches.every((b) => selectedBatchIds.has(b.id));
  const toggleAll = () => {
    setSelectedBatchIds((s) => {
      const n = new Set(s);
      if (allSelected) {
        for (const b of batches) n.delete(b.id);
      } else {
        for (const b of batches) n.add(b.id);
      }
      return n;
    });
  };

  const canRun =
    !!boundBackend &&
    selectedBatchIds.size > 0 &&
    !!prompt.trim() &&
    !running;

  const onRun = async () => {
    if (!boundBackend || !prompt.trim() || selectedBatchIds.size === 0) return;
    const ids = Array.from(selectedBatchIds);
    const baseArgs = {
      ml_backend_id: boundBackend.id,
      prompt: prompt.trim(),
      output_mode: outputMode,
    };
    setRunning(true);
    try {
      let okCount = 0;
      let failCount = 0;
      const errors: string[] = [];
      const fireOne = async (bid: string) => {
        try {
          await trigger.mutateAsync({ ...baseArgs, batch_id: bid });
          okCount += 1;
        } catch (err) {
          failCount += 1;
          errors.push(`${bid.slice(0, 8)}: ${(err as Error).message}`);
        }
      };
      if (concurrency === "serial") {
        for (const bid of ids) {
          await fireOne(bid);
        }
      } else {
        await Promise.all(ids.map(fireOne));
      }
      pushToast({
        msg: `${concurrency === "serial" ? "串行" : "并行"} 预标已分发`,
        sub: `${okCount} 成功 · ${failCount} 失败`,
        kind: failCount > 0 ? "warning" : "success",
      });
      if (failCount > 0 && errors.length > 0) {
        // eslint-disable-next-line no-console
        console.warn("[ai-pre] 多批次预标部分失败:", errors);
      }
      if (okCount > 0) setSelectedBatchIds(new Set());
    } finally {
      setRunning(false);
    }
  };

  const headerName = summary?.project_name ?? `项目 ${projectId.slice(0, 8)}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: SECTION_GAP }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <Button size="sm" variant="ghost" onClick={onBack}>
          <Icon name="chevLeft" size={11} /> 返回项目列表
        </Button>
        <h2 style={{ margin: 0, fontSize: FS_LG, fontWeight: 600 }}>{headerName}</h2>
        {summary?.project_display_id && (
          <span style={{ color: "var(--color-fg-subtle)", fontSize: FS_SM }}>
            ({summary.project_display_id})
          </span>
        )}
        {boundBackend ? (
          <Badge variant="ai">{boundBackend.name}</Badge>
        ) : (
          <Badge variant="warning">未绑定 ML backend</Badge>
        )}
        {summary?.ml_backend_max_concurrency != null && (
          <span style={{ fontSize: FS_XS, color: "var(--color-fg-muted)" }}>
            最多 {summary.ml_backend_max_concurrency} 并发
          </span>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => navigate(`/ai-pre/jobs?project_id=${projectId}`)}
          title="该项目所有 prediction job 历史"
        >
          <Icon name="history" size={11} /> 历史 job
        </Button>
      </div>

      <Card>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 14px",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          <strong style={{ fontSize: FS_SM }}>待预标批次（{batches.length}）</strong>
          {batches.length > 0 && (
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: FS_XS }}>
              <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="全选 active" />
              全选
            </label>
          )}
        </div>
        <div style={{ padding: "10px 14px" }}>
          {batchesQ.isLoading ? (
            <div style={{ color: "var(--color-fg-muted)", fontSize: FS_SM }}>加载中…</div>
          ) : batches.length === 0 ? (
            <div style={{ color: "var(--color-fg-muted)", fontSize: FS_SM }}>
              暂无 active 批次。在项目设置中创建批次后再回到这里跑预标。
            </div>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              {batches.map((b) => (
                <li
                  key={b.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "6px 8px",
                    background: selectedBatchIds.has(b.id)
                      ? "color-mix(in oklch, var(--color-accent) 8%, transparent)"
                      : "transparent",
                    borderRadius: "var(--radius-sm)",
                    cursor: "pointer",
                  }}
                  onClick={() => toggleBatch(b.id)}
                >
                  <input
                    type="checkbox"
                    aria-label={`选择 ${b.name}`}
                    checked={selectedBatchIds.has(b.id)}
                    onChange={() => toggleBatch(b.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span style={{ fontSize: FS_SM, flex: 1 }}>
                    {b.name}{" "}
                    <span style={{ color: "var(--color-fg-subtle)" }}>({b.display_id})</span>
                  </span>
                  <span style={{ fontSize: FS_XS, color: "var(--color-fg-muted)", fontVariantNumeric: "tabular-nums" }}>
                    {b.total_tasks ?? "—"} 任务
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {selectedBatchIds.size > 0 && (
        <Card>
          <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
            <strong style={{ fontSize: FS_SM }}>
              对已选 {selectedBatchIds.size} 批跑预标
            </strong>

            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: FS_XS, color: "var(--color-fg-muted)" }}>
                Prompt（同一段文本应用到所有选中批次；逗号分隔）
              </span>
              <textarea
                rows={2}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="例：car, person, traffic light"
                style={{
                  padding: "8px 10px",
                  fontSize: FS_SM,
                  background: "var(--color-bg-sunken)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-sm)",
                  color: "var(--color-fg)",
                  fontFamily: "inherit",
                  resize: "vertical",
                }}
              />
            </label>

            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: FS_XS, color: "var(--color-fg-muted)" }}>输出形态</span>
              <TabRow
                tabs={OUTPUT_MODE_TABS}
                active={OUTPUT_MODE_LABELS[outputMode]}
                onChange={(label) => {
                  const m = OUTPUT_MODE_BY_LABEL[label];
                  if (m) setOutputMode(m);
                }}
              />
            </div>

            {selectedBatchIds.size > 1 && (
              <div role="radiogroup" aria-label="并发模式" style={{ display: "inline-flex", gap: 14, fontSize: FS_XS }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="concurrency"
                    checked={concurrency === "serial"}
                    onChange={() => setConcurrency("serial")}
                  />
                  串行（依次入队）
                </label>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="concurrency"
                    checked={concurrency === "parallel"}
                    onChange={() => setConcurrency("parallel")}
                  />
                  并行（同时入队）
                </label>
                {summary?.ml_backend_max_concurrency != null && (
                  <span style={{ color: "var(--color-fg-muted)" }}>
                    （后端最多 {summary.ml_backend_max_concurrency} 并发）
                  </span>
                )}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Button onClick={onRun} disabled={!canRun}>
                <Icon name="bot" size={12} />
                {running ? "分发中..." : `跑预标（${selectedBatchIds.size} 批）`}
              </Button>
            </div>
          </div>
        </Card>
      )}

      <HistoryTable items={projectQueue} isLoading={queueQ.isLoading} />
    </div>
  );
}
