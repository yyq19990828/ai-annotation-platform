/**
 * v0.9.5 · /ai-pre 文本批量预标页面
 *
 * 流程：选项目 → 选 batch（active 状态） → 输入英文 prompt（可从类别 alias 下拉填）
 *      → 选输出形态（box/mask/both）→ 跑预标 → WS 实时进度 → 跑完 batch 转 pre_annotated。
 *
 * 设计要点：
 * - prompt 输入支持下拉「project.classes_config 已配置 alias 的类别」，避免运行时翻译；
 *   未配 alias 时退回纯文本 textbox。
 * - outputMode 默认按项目 type_key 智能选（image-det → box / 其它 → mask），
 *   与工作台 SamTextPanel 保持一致。
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { TabRow } from "@/components/ui/TabRow";
import { Icon } from "@/components/ui/Icon";
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
const OUTPUT_MODE_TABS = Object.values(OUTPUT_MODE_LABELS);

function defaultOutputMode(typeKey: string | undefined | null): TextOutputMode {
  if (typeKey === "image-det") return "box";
  if (typeKey === "image-seg") return "mask";
  return "mask";
}

export default function AIPreAnnotatePage() {
  const pushToast = useToastStore((s) => s.push);
  const navigate = useNavigate();

  // v0.9.6 · 历史: pre_annotated 批次列表 (5 分钟 stale)
  const queueQ = useQuery({
    queryKey: ["admin", "preannotate-queue"],
    queryFn: () => adminPreannotateApi.queue(50),
    staleTime: 1000 * 60 * 5,
  });

  const [projectId, setProjectId] = useState<string>("");
  const [batchId, setBatchId] = useState<string>("");
  const [prompt, setPrompt] = useState<string>("");
  const [outputMode, setOutputMode] = useState<TextOutputMode>("mask");
  // v0.9.6 · alias chips 搜索过滤 (30+ 类别全配 alias 时避免铺满整行)
  const [aliasFilter, setAliasFilter] = useState<string>("");

  // 拉数据
  const projectsQ = useProjects();
  const projects = useMemo(
    () => (projectsQ.data ?? []).filter((p) => p.ai_enabled),
    [projectsQ.data],
  );
  const projectQ = useProject(projectId);
  const project = projectQ.data;
  const batchesQ = useBatches(projectId, "active");
  const batches = useMemo(() => batchesQ.data ?? [], [batchesQ.data]);
  const backendsQ = useMLBackends(projectId);
  const backends = backendsQ.data ?? [];
  const boundBackend = backends.find((b) => b.id === project?.ml_backend_id) ?? null;

  // 类别 alias 下拉（仅取已配置 alias 的）
  const aliases = useMemo(() => {
    const cfg = project?.classes_config ?? {};
    return Object.entries(cfg)
      .map(([name, entry]) => ({ name, alias: entry?.alias ?? null }))
      .filter((e): e is { name: string; alias: string } => !!e.alias);
  }, [project]);

  // 项目切换：重置 batch / 智能默认 outputMode
  useEffect(() => {
    setBatchId("");
    setOutputMode(defaultOutputMode(project?.type_key));
  }, [project?.type_key, projectId]);

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

  const progressPct = progress && progress.total > 0
    ? Math.round((progress.current / progress.total) * 100)
    : 0;

  return (
    <div style={{ padding: "20px 28px", display: "flex", flexDirection: "column", gap: 16 }}>
      <header>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>AI 文本批量预标</h1>
        <p style={{ fontSize: 12, color: "var(--color-fg-muted)", marginTop: 4 }}>
          为指定批次批量跑 SAM 文本预标。跑完后批次自动转 pre_annotated 状态，等待人工接管。
        </p>
      </header>

      {/* ── 1. 项目 + Batch 选择 ─────────────────────────────────────── */}
      <Card>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={labelStyle}>项目（仅显示已启用 AI）</label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              style={selectStyle}
              disabled={projectsQ.isLoading}
            >
              <option value="">-- 请选择 --</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_id} · {p.name} ({p.type_label})
                </option>
              ))}
            </select>
          </div>

          {projectId && (
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <label style={labelStyle}>批次（active 状态可预标）</label>
                {boundBackend ? (
                  <Badge variant="success" style={{ fontSize: 10 }}>
                    backend: {boundBackend.name}
                  </Badge>
                ) : (
                  <Badge variant="danger" style={{ fontSize: 10 }}>
                    未绑定 ML Backend，请到项目设置配置
                  </Badge>
                )}
              </div>
              {batches.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--color-fg-subtle)", padding: 8 }}>
                  本项目暂无 active 批次（draft → active 转换后可见）
                </div>
              ) : (
                <select
                  value={batchId}
                  onChange={(e) => setBatchId(e.target.value)}
                  style={selectStyle}
                >
                  <option value="">-- 请选择 --</option>
                  {batches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.display_id} · {b.name} （共 {b.total_tasks ?? 0} 张）
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* ── 2. Prompt 输入 + 输出形态 ─────────────────────────────────── */}
      {projectId && batchId && (
        <Card>
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label style={labelStyle}>Prompt（英文召回最佳）</label>
              {aliases.length > 0 && (
                <div style={{ marginBottom: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>
                      类别 alias 快速填入 ({aliases.length})：
                    </span>
                    {aliases.length > 6 && (
                      <input
                        type="text"
                        value={aliasFilter}
                        onChange={(e) => setAliasFilter(e.target.value)}
                        placeholder="筛选 alias..."
                        style={{
                          flex: 1,
                          maxWidth: 180,
                          padding: "2px 8px",
                          fontSize: 11,
                          background: "var(--color-bg-sunken)",
                          border: "1px solid var(--color-border)",
                          borderRadius: "var(--radius-sm)",
                          color: "var(--color-fg)",
                          outline: "none",
                        }}
                      />
                    )}
                  </div>
                  {/* v0.9.6 · 类别 30+ 全配 alias 时, chips 限高 + 横向滚动避免铺满整行. */}
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                      maxHeight: 96,
                      overflowY: "auto",
                      padding: "2px 0",
                    }}
                  >
                    {aliases
                      .filter((a) => {
                        if (!aliasFilter.trim()) return true;
                        const f = aliasFilter.toLowerCase();
                        return a.alias.toLowerCase().includes(f) || a.name.toLowerCase().includes(f);
                      })
                      .map((a) => (
                        <button
                          key={a.name}
                          type="button"
                          onClick={() => setPrompt(a.alias)}
                          style={aliasChipStyle}
                          title={`使用类别「${a.name}」的 alias`}
                        >
                          {a.alias}
                          <span style={{ color: "var(--color-fg-subtle)", marginLeft: 4 }}>
                            ({a.name})
                          </span>
                        </button>
                      ))}
                  </div>
                </div>
              )}
              <input
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. person, car, ripe apple"
                style={selectStyle}
              />
              <div style={{ fontSize: 11, color: "var(--color-fg-subtle)", marginTop: 4 }}>
                项目当前 DINO 阈值：box={project?.box_threshold ?? 0.35} / text={project?.text_threshold ?? 0.25}
              </div>
            </div>

            <div>
              <label style={labelStyle}>输出形态</label>
              <TabRow
                tabs={OUTPUT_MODE_TABS}
                active={OUTPUT_MODE_LABELS[outputMode]}
                onChange={(label) => {
                  const m = OUTPUT_MODE_BY_LABEL[label];
                  if (m) setOutputMode(m);
                }}
              />
              <div style={{ fontSize: 11, color: "var(--color-fg-subtle)", marginTop: 4 }}>
                {outputMode === "box" && "仅 DINO 出框，跳过 SAM 推理（image-det 项目首选，速度 ×3-5）"}
                {outputMode === "mask" && "DINO + SAM mask → polygon（image-seg 项目首选）"}
                {outputMode === "both" && "同实例配对返回框 + 掩膜，标注员可挑选粒度"}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Button
                variant="ai"
                disabled={!canRun}
                onClick={onRun}
              >
                <Icon name="wandSparkles" size={14} />{" "}
                {trigger.isPending ? "排队中…" : running ? "推理中…" : "跑预标"}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* ── 3. 历史 (pre_annotated 批次列表) v0.9.6 ───────────────────── */}
      {queueQ.data && queueQ.data.items.length > 0 && (
        <Card>
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                AI 预标已就绪批次 ({queueQ.data.items.length})
              </span>
              <span style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>
                按最近预标时间排序
              </span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "var(--color-bg-sunken)" }}>
                    {["项目", "批次", "总数", "已预标", "失败", "操作"].map((h) => (
                      <th
                        key={h}
                        style={{
                          padding: "6px 10px",
                          textAlign: "left",
                          fontWeight: 500,
                          color: "var(--color-fg-muted)",
                          borderBottom: "1px solid var(--color-border)",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {queueQ.data.items.map((it) => (
                    <tr key={it.batch_id}>
                      <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--color-border)" }}>
                        {it.project_name}
                        {it.project_display_id && (
                          <span style={{ marginLeft: 6, color: "var(--color-fg-subtle)" }}>
                            ({it.project_display_id})
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--color-border)" }}>
                        {it.batch_name}
                      </td>
                      <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--color-border)" }}>
                        {it.total_tasks}
                      </td>
                      <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--color-border)" }}>
                        <Badge variant="ai">{it.prediction_count}</Badge>
                      </td>
                      <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--color-border)" }}>
                        {it.failed_count > 0 ? (
                          <Badge variant="danger">{it.failed_count}</Badge>
                        ) : (
                          <span style={{ color: "var(--color-fg-subtle)" }}>0</span>
                        )}
                      </td>
                      <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--color-border)" }}>
                        <div style={{ display: "inline-flex", gap: 6 }}>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              navigate(`/projects/${it.project_id}/annotate?batch=${it.batch_id}`)
                            }
                            title="打开工作台接管 review"
                          >
                            <Icon name="chevRight" size={11} />
                          </Button>
                          {it.can_retry && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                navigate(`/model-market?tab=failed&batch_id=${it.batch_id}`)
                              }
                              title="去失败 prediction 列表重试"
                            >
                              <Icon name="refresh" size={11} />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      )}

      {/* ── 4. 进度 ──────────────────────────────────────────────────── */}
      {progress && (
        <Card>
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>批次进度</span>
              <span style={{ fontSize: 12, color: "var(--color-fg-muted)" }}>
                WS: {connection} · {progress.status}
              </span>
            </div>
            <ProgressBar value={progressPct} color="var(--color-ai)" />
            <div style={{ fontSize: 12, color: "var(--color-fg-muted)", display: "flex", justifyContent: "space-between" }}>
              <span>
                {progress.current} / {progress.total} 张（{progressPct}%）
              </span>
              {progress.error && (
                <span style={{ color: "var(--color-danger)" }}>{progress.error}</span>
              )}
            </div>
            {progress.status === "completed" && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: "var(--color-success)" }}>
                  ✓ 已跑完。批次状态已自动转为 pre_annotated，可在工作台接管 review。
                </span>
                {/* v0.9.6 · prominent CTA 一键跳工作台接管 */}
                <Button
                  variant="ai"
                  size="sm"
                  onClick={() =>
                    navigate(`/projects/${projectId}/annotate?batch=${batchId}`)
                  }
                >
                  打开标注工作台 <Icon name="chevRight" size={11} />
                </Button>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  marginBottom: 6,
  color: "var(--color-fg)",
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "6px 10px",
  fontSize: 13,
  background: "var(--color-bg-sunken)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  color: "var(--color-fg)",
  fontFamily: "inherit",
};

const aliasChipStyle: React.CSSProperties = {
  fontSize: 11,
  padding: "2px 8px",
  background: "var(--color-ai-soft)",
  border: "1px solid var(--color-border)",
  borderRadius: 999,
  color: "var(--color-fg)",
  cursor: "pointer",
  fontFamily: "inherit",
};
