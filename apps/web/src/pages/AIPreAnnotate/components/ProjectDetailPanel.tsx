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
import { useBatchEventsSocket } from "@/hooks/useBatchEventsSocket";
import { useMLBackends } from "@/hooks/useMLBackends";
import {
  useTriggerPreannotation,
  type TextOutputMode,
} from "@/hooks/usePreannotation";
import { adminPreannotateApi } from "@/api/adminPreannotate";
import { aliasFrequencyApi } from "@/api/aliasFrequency";
import { mlBackendsApi } from "@/api/ml-backends";
import {
  SchemaForm,
  deriveDefaults,
  type JsonSchemaObject,
} from "@/pages/Workbench/components/SchemaForm";
import { useAiToolParamPrefs } from "@/pages/Workbench/state/useAiToolParamPrefs";

import { TabRow } from "@/components/ui/TabRow";
import { HistoryTable } from "./HistoryTable";
import { VideoPreannotateGuide } from "./VideoPreannotateGuide";
import { PredictionImportWizard } from "@/components/predictions/PredictionImportWizard";
import styles from "./ProjectDetailPanel.module.css";

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

function cx(...classNames: Array<string | false | null | undefined>) {
  return classNames.filter(Boolean).join(" ");
}

interface Props {
  projectId: string;
  onBack: () => void;
  /** 项目卡片传入的聚合摘要（用于头部 ml_backend chip + 并发上限）；不可省的部分会再用 hooks 拉. */
  summary?: {
    project_name: string;
    project_display_id?: string | null;
    /** v0.10.38 · 媒体维度, 用于按模态分流 (image=文本批量预标 / video=引导卡片). */
    data_type?: string | null;
    ml_backend_id?: string | null;
    ml_backend_name?: string | null;
    ml_backend_state?: string | null;
    ml_backend_max_concurrency?: number | null;
  };
}

export function ProjectDetailPanel({ projectId, onBack, summary }: Props) {
  const pushToast = useToastStore((s) => s.push);
  const navigate = useNavigate();

  // v0.9.13 · 订阅 batch 状态变更, 让"待预标批次"列表实时刷新 (B-15)
  useBatchEventsSocket(projectId);

  const projectQ = useProject(projectId);
  const project = projectQ.data as unknown as
    | {
        type_key?: string;
        data_type?: string | null;
        ml_backend_id?: string | null;
        classes_config?: Record<string, { alias?: string | null }>;
        box_threshold?: number | null;
        text_threshold?: number | null;
      }
    | undefined;
  // v0.10.38 · 模态分流: summary 优先 (列表已带), 回落 project 查询.
  const dataType = summary?.data_type ?? project?.data_type ?? "image";
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
  // v0.10.38 · 多 backend 选择: 默认绑定值, 用户可在项目已注册 backend 间切换 (epic 阶段 2).
  const [selectedBackendId, setSelectedBackendId] = useState<string | null>(null);
  const firstBackendId = backends[0]?.id ?? null;
  useEffect(() => {
    // 项目切换 / 列表加载后, 默认选绑定 backend (否则第一个)
    setSelectedBackendId(project?.ml_backend_id ?? firstBackendId);
  }, [projectId, project?.ml_backend_id, firstBackendId]);
  const selectedBackend =
    backends.find((b) => b.id === selectedBackendId) ?? null;

  // v0.10.38 · 按后端参数面板: 拉选中 backend 的 /setup.params 渲染 SchemaForm,
  // 值按 backend 分桶持久化 (复用工作台 useAiToolParamPrefs), 运行时塞进请求 params.
  const setupQ = useQuery({
    queryKey: ["ml-backends", projectId, selectedBackendId, "setup"],
    queryFn: () => mlBackendsApi.setup(projectId, selectedBackendId as string),
    enabled: !!selectedBackendId,
    staleTime: 60_000,
    retry: false,
  });
  const paramsSchema = setupQ.data?.params as JsonSchemaObject | undefined;
  const { savedParams, save: saveParams } = useAiToolParamPrefs(selectedBackendId);
  const [paramsValue, setParamsValue] = useState<Record<string, unknown>>({});
  // 选中 backend / schema / 偏好就绪时, 用 偏好 → schema 默认 重建参数值
  useEffect(() => {
    if (!selectedBackendId) return;
    setParamsValue({ ...deriveDefaults(paramsSchema), ...(savedParams ?? {}) });
  }, [selectedBackendId, paramsSchema, savedParams]);
  const onParamsChange = (next: Record<string, unknown>) => {
    setParamsValue(next);
    saveParams(next);
  };

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
  // v0.10.15 · 外部预测导入向导 (COCO / AAP JSON)
  const [importOpen, setImportOpen] = useState(false);

  // v0.9.13 · prompt token 集合 (复用 PromptComposer.tsx:84 模式), 用于 chip active 态判定
  const promptTokenSet = useMemo(() => {
    const tokens = prompt
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    return new Set(tokens);
  }, [prompt]);

  const toggleAlias = (alias: string) => {
    const a = alias.trim();
    if (!a) return;
    const aLower = a.toLowerCase();
    if (promptTokenSet.has(aLower)) {
      const next = prompt
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t && t.toLowerCase() !== aLower)
        .join(", ");
      setPrompt(next);
    } else {
      const trimmed = prompt.trim().replace(/,\s*$/, "");
      setPrompt(trimmed ? `${trimmed}, ${a}` : a);
    }
  };

  // 项目切换时重置选择 / 默认 outputMode / prompt
  useEffect(() => {
    setSelectedBatchIds(new Set());
    // v0.10.28 · 遗留技术债: AI 输出形态分流仍按 type_key (image-det → box, 其余 mask).
    // data_type 只到媒体粒度, 无法区分检测 vs 分割; 后续应改读 tool_bindings 是否启用
    // region. 本次 data_type 迁移不动此处, 保持原 AI 分流行为.
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
    !!selectedBackend &&
    selectedBatchIds.size > 0 &&
    !!prompt.trim() &&
    !running;

  const onRun = async () => {
    if (!selectedBackend || !prompt.trim() || selectedBatchIds.size === 0) return;
    const ids = Array.from(selectedBatchIds);
    const baseArgs = {
      ml_backend_id: selectedBackend.id,
      prompt: prompt.trim(),
      output_mode: outputMode,
      params: paramsValue,
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
        console.warn("[ai-pre] 多批次预标部分失败:", errors);
      }
      if (okCount > 0) setSelectedBatchIds(new Set());
    } finally {
      setRunning(false);
    }
  };

  const headerName = summary?.project_name ?? `项目 ${projectId.slice(0, 8)}`;

  // v0.10.38 · 模态分流: 视频项目无批量文本预标语义 (AI 预标在工作台逐轨迹 Shift+T 发起),
  // 渲染引导卡片 + job 历史链接, 不误用图像批量面板 (epic 阶段 2).
  if (dataType === "video") {
    return (
      <VideoPreannotateGuide
        projectId={projectId}
        projectName={headerName}
        displayId={summary?.project_display_id}
        onBack={onBack}
      />
    );
  }
  if (dataType === "lidar") {
    return (
      <div className={styles.root}>
        <div className={styles.header}>
          <Button size="sm" variant="ghost" onClick={onBack}>
            <Icon name="chevLeft" size={11} /> 返回项目列表
          </Button>
          <h2 className={styles.title}>{headerName}</h2>
        </div>
        <Card>
          <div className={styles.mutedText}>点云（lidar）项目暂不支持 AI 预标。</div>
        </Card>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <Button size="sm" variant="ghost" onClick={onBack}>
          <Icon name="chevLeft" size={11} /> 返回项目列表
        </Button>
        <h2 className={styles.title}>{headerName}</h2>
        {summary?.project_display_id && (
          <span className={styles.displayId}>
            ({summary.project_display_id})
          </span>
        )}
        {selectedBackend ? (
          <Badge variant="ai">{selectedBackend.name}</Badge>
        ) : (
          <Badge variant="warning">未绑定 ML backend</Badge>
        )}
        {summary?.ml_backend_max_concurrency != null && (
          <span className={styles.backendLimit}>
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
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setImportOpen(true)}
          title="上传 COCO / AAP JSON 把外部模型预测灌进本项目"
        >
          <Icon name="upload" size={11} /> 导入预测
        </Button>
      </div>

      <PredictionImportWizard
        open={importOpen}
        onClose={() => setImportOpen(false)}
        projectId={projectId}
      />

      <Card>
        <div className={styles.cardHeader}>
          <strong className={styles.sectionTitle}>待预标批次（{batches.length}）</strong>
          {batches.length > 0 && (
            <label className={styles.inlineCheckbox}>
              <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="全选 active" />
              全选
            </label>
          )}
        </div>
        <div className={styles.cardBodyCompact}>
          {batchesQ.isLoading ? (
            <div className={styles.mutedText}>加载中…</div>
          ) : batches.length === 0 ? (
            <div className={styles.mutedText}>
              暂无 active 批次。在项目设置中创建批次后再回到这里跑预标。
            </div>
          ) : (
            <ul className={styles.batchList}>
              {batches.map((b) => (
                <li
                  key={b.id}
                  className={cx(styles.batchItem, selectedBatchIds.has(b.id) && styles.batchItemSelected)}
                  onClick={() => toggleBatch(b.id)}
                >
                  <input
                    type="checkbox"
                    aria-label={`选择 ${b.name}`}
                    checked={selectedBatchIds.has(b.id)}
                    onChange={() => toggleBatch(b.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className={styles.batchName}>
                    {b.name}{" "}
                    <span className={styles.subtleText}>({b.display_id})</span>
                  </span>
                  <span className={styles.taskCount}>
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
          <div className={styles.runPanel}>
            <strong className={styles.sectionTitle}>
              对已选 {selectedBatchIds.size} 批跑预标
            </strong>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                Prompt（同一段文本应用到所有选中批次；逗号分隔）
              </span>
              {/* v0.9.13 · alias chips: 点击 toggle prompt 添加 / 移除. 频率排序见 aliases useMemo. */}
              {aliases.length > 0 && (
                <div className={styles.aliasList}>
                  {aliases.map((a) => {
                    const isActive = promptTokenSet.has(a.alias.toLowerCase());
                    return (
                      <button
                        key={a.name}
                        type="button"
                        onClick={() => toggleAlias(a.alias)}
                        className={cx(styles.aliasChip, isActive && styles.aliasChipActive)}
                        title={`${isActive ? "移除" : "添加"} 类别「${a.name}」的 alias${a.count > 0 ? ` · 历史 ${a.count} 次` : ""}`}
                      >
                        <span>{isActive ? "✓ " : ""}{a.alias}</span>
                        <span className={styles.aliasName}>
                          ({a.name})
                        </span>
                        {a.count > 0 && (
                          <span className={styles.aliasCount}>
                            ×{a.count}
                          </span>
                        )}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setPrompt(aliases.map((x) => x.alias).join(", "))}
                    className={styles.refillButton}
                    title="一键重填: 按频率拼上所有 alias"
                  >
                    重填
                  </button>
                </div>
              )}
              <textarea
                rows={2}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="例：car, person, traffic light"
                className={styles.promptInput}
              />
            </label>

            {/* v0.10.38 · 多 backend 选择: 在项目已注册 backend 间选, 默认绑定值 (epic 阶段 2) */}
            {backends.length > 1 && (
              <label className={styles.field}>
                <span className={styles.fieldLabel}>ML Backend</span>
                <select
                  value={selectedBackendId ?? ""}
                  onChange={(e) => setSelectedBackendId(e.target.value || null)}
                  className={styles.promptInput}
                >
                  {backends.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                      {b.id === project?.ml_backend_id ? "（绑定）" : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {/* v0.10.38 · 按后端参数面板: 复用 SchemaForm 按选中 backend 的 /setup.params 渲染.
                gsam2 即 box/text_threshold; 值按 backend 记忆 (params_by_backend), 运行时随请求覆盖
                项目级阈值兜底. 取代旧的项目级 ThresholdRow (项目默认仍可在项目设置 GeneralSection 改). */}
            <div className={styles.field}>
              <span className={styles.fieldLabel}>
                后端推理参数（按 backend 记忆，覆盖项目默认）
              </span>
              {setupQ.isLoading ? (
                <div className={styles.mutedText}>加载参数…</div>
              ) : setupQ.isError ? (
                <div className={styles.mutedText}>
                  无法拉取 backend /setup，运行时回落项目级阈值。
                </div>
              ) : (
                <SchemaForm
                  schema={paramsSchema}
                  value={paramsValue}
                  onChange={onParamsChange}
                />
              )}
            </div>

            <div className={styles.field}>
              <span className={styles.fieldLabel}>输出形态</span>
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
              <div role="radiogroup" aria-label="并发模式" className={styles.concurrencyGroup}>
                <label className={styles.radioLabel}>
                  <input
                    type="radio"
                    name="concurrency"
                    checked={concurrency === "serial"}
                    onChange={() => setConcurrency("serial")}
                  />
                  串行（依次入队）
                </label>
                <label className={styles.radioLabel}>
                  <input
                    type="radio"
                    name="concurrency"
                    checked={concurrency === "parallel"}
                    onChange={() => setConcurrency("parallel")}
                  />
                  并行（同时入队）
                </label>
                {summary?.ml_backend_max_concurrency != null && (
                  <span className={styles.mutedInline}>
                    （后端最多 {summary.ml_backend_max_concurrency} 并发）
                  </span>
                )}
              </div>
            )}

            <div className={styles.actions}>
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
