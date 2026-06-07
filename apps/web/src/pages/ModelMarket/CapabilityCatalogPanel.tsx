// v0.14.9 · 模型市场「能力目录」面板 — 能力声明协议 v2 的消费视图.
// 与「项目级 ML Backend」表格不同, 这里按 *model 条目* 展开:
//   - 枚举所有项目已注册 backend (admin overview), 对每个 backend 拉 /capabilities 拿 models[];
//   - 每个 model 渲染一张卡片 (task/infra/modality badge + 输出几何 + 输出属性 + variants + resource);
//   - 老 backend (协议 v1) 由平台合成单 model, models 长度=1, 正常显示;
//   - 工具栏按 task / model_family / infra / modality 多选 chips 过滤;
//   - 「刷新」对每个 backend 调 refreshCapabilities 重探并刷新缓存.
// 仅消费已落地契约 (api/ml-backends.ts + adminMlIntegrations.ts), 不改 api / types.

import { useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueries, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useToastStore } from "@/components/ui/Toast";
import { adminMlIntegrationsApi, type MLBackendItem } from "@/api/adminMlIntegrations";
import {
  mlBackendsApi,
  type MLBackendCapability,
  type MLModelCapability,
} from "@/api/ml-backends";
import styles from "./CapabilityCatalogPanel.module.css";

// 受控 task → 中文短标签 (协议 v2 边界枚举).
const TASK_LABELS: Record<string, string> = {
  detection: "检测",
  obb: "旋转框",
  segmentation: "分割",
  keypoint: "关键点",
  classification: "分类",
  ocr: "OCR",
  doc_layout: "版面分析",
  tracker: "追踪",
  interactive_seg: "交互分割",
};

// 受控 infra → 中文短标签.
const INFRA_LABELS: Record<string, string> = {
  pytorch: "PyTorch",
  onnx: "ONNX",
  paddle: "Paddle",
  tensorrt: "TensorRT",
  openvino: "OpenVINO",
  other: "其它",
  unknown: "未知",
};

const MODALITY_LABELS: Record<string, string> = {
  image: "图像",
  video: "视频",
  text: "文本",
  point_cloud: "点云",
};

function taskLabel(task: string) {
  return TASK_LABELS[task] ?? task;
}
function infraLabel(infra: string) {
  return INFRA_LABELS[infra] ?? infra;
}
function modalityLabel(m: string) {
  return MODALITY_LABELS[m] ?? m;
}

// task → badge 配色 (复用既有 Badge variant, 不引入新 token).
function taskVariant(task: string): "accent" | "ai" | "success" | "warning" | "outline" {
  if (task === "detection" || task === "obb") return "accent";
  if (task === "segmentation" || task === "interactive_seg") return "ai";
  if (task === "keypoint" || task === "classification") return "success";
  if (task === "ocr" || task === "doc_layout") return "warning";
  return "outline";
}

// 一个展开后的 model 条目 (附带其来源 backend, 供分组/过滤/标题用).
interface FlatModel {
  model: MLModelCapability;
  backendId: string;
  backendName: string;
  projectId: string;
  projectName: string;
  // backend 默认 infra / modalities, model 缺省时回落.
  backendInfra?: string;
  backendModalities?: string[];
  stale: boolean;
}

// 单个 backend 的 capability 拉取结果 (含失败态供降级提示).
interface BackendResult {
  backend: MLBackendItem;
  projectName: string;
  data?: MLBackendCapability;
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
}

// model 的有效 infra: 优先 model.infra, 回落 backend.infra.
function effectiveInfra(m: MLModelCapability, backendInfra?: string): string | undefined {
  return m.infra ?? backendInfra;
}

// model 的有效 modality: 优先 model.modality, 回落 backend.modalities (派生).
function effectiveModalities(m: MLModelCapability, backendModalities?: string[]): string[] {
  if (m.modality) return [m.modality];
  return backendModalities ?? [];
}

export function CapabilityCatalogPanel() {
  const qc = useQueryClient();
  const pushToast = useToastStore((s) => s.push);
  const [refreshing, setRefreshing] = useState(false);

  // 1) 枚举所有项目 + 已注册 backend.
  const {
    data: overview,
    isLoading: overviewLoading,
    isError: overviewError,
    error: overviewErr,
    refetch: refetchOverview,
  } = useQuery({
    queryKey: ["admin", "ml-integrations", "overview"],
    queryFn: () => adminMlIntegrationsApi.overview(),
    refetchInterval: 60_000,
  });

  // 扁平化 (project, backend) 对.
  const backendRefs = useMemo(() => {
    const refs: { backend: MLBackendItem; projectName: string }[] = [];
    for (const p of overview?.projects ?? []) {
      for (const b of p.backends) refs.push({ backend: b, projectName: p.project_name });
    }
    return refs;
  }, [overview]);

  // 2) 对每个 backend 拉 /capabilities (独立 query, 互不阻塞).
  const capabilityQueries = useQueries({
    queries: backendRefs.map((ref) => ({
      queryKey: ["ml-backend-capabilities", ref.backend.project_id, ref.backend.id],
      queryFn: () => mlBackendsApi.capabilities(ref.backend.project_id, ref.backend.id),
      staleTime: 60_000,
    })),
  });

  const results: BackendResult[] = backendRefs.map((ref, i) => {
    const q = capabilityQueries[i];
    return {
      backend: ref.backend,
      projectName: ref.projectName,
      data: q?.data,
      isLoading: q?.isLoading ?? false,
      isError: q?.isError ?? false,
      error: q?.error,
    };
  });

  // 3) 展开为 FlatModel 列表 (合成单 model 的老 backend 也走同一路径).
  const flatModels: FlatModel[] = useMemo(() => {
    const out: FlatModel[] = [];
    for (const r of results) {
      if (!r.data) continue;
      const cap = r.data;
      // capabilities 端点对老 backend 会合成 models[]; 若仍为空, 兜底从顶层字段合成一个.
      const models: MLModelCapability[] =
        cap.models && cap.models.length > 0
          ? cap.models
          : [
              {
                id: r.backend.id,
                display_name: cap.name ?? r.backend.name,
                is_interactive: cap.is_interactive,
                supported_prompts: cap.supported_prompts,
                supported_geometric_outputs: cap.supported_geometric_outputs,
                supported_text_outputs: cap.supported_text_outputs,
                supported_trackers: cap.supported_trackers,
                supported_variants: cap.supported_variants,
                infra: cap.infra,
              },
            ];
      // stale: backend 离线 / 上次探测失败时, 目录可能是缓存旧值.
      const stale = r.backend.state !== "connected";
      for (const m of models) {
        out.push({
          model: m,
          backendId: r.backend.id,
          backendName: r.backend.name,
          projectId: r.backend.project_id,
          projectName: r.projectName,
          backendInfra: cap.infra,
          backendModalities: cap.modalities,
          stale,
        });
      }
    }
    return out;
  }, [results]);

  // 4) 从已加载 model 派生过滤选项.
  const facets = useMemo(() => {
    const tasks = new Set<string>();
    const families = new Set<string>();
    const infras = new Set<string>();
    const modalities = new Set<string>();
    for (const f of flatModels) {
      if (f.model.task) tasks.add(f.model.task);
      if (f.model.model_family) families.add(f.model.model_family);
      const inf = effectiveInfra(f.model, f.backendInfra);
      if (inf) infras.add(inf);
      for (const mod of effectiveModalities(f.model, f.backendModalities)) modalities.add(mod);
    }
    return {
      tasks: [...tasks].sort(),
      families: [...families].sort(),
      infras: [...infras].sort(),
      modalities: [...modalities].sort(),
    };
  }, [flatModels]);

  // 多选过滤 (空集 = 不过滤该轴).
  const [taskFilter, setTaskFilter] = useState<Set<string>>(new Set());
  const [familyFilter, setFamilyFilter] = useState<Set<string>>(new Set());
  const [infraFilter, setInfraFilter] = useState<Set<string>>(new Set());
  const [modalityFilter, setModalityFilter] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    return flatModels.filter((f) => {
      if (taskFilter.size > 0 && !(f.model.task && taskFilter.has(f.model.task))) return false;
      if (familyFilter.size > 0 && !(f.model.model_family && familyFilter.has(f.model.model_family)))
        return false;
      if (infraFilter.size > 0) {
        const inf = effectiveInfra(f.model, f.backendInfra);
        if (!inf || !infraFilter.has(inf)) return false;
      }
      if (modalityFilter.size > 0) {
        const mods = effectiveModalities(f.model, f.backendModalities);
        if (!mods.some((m) => modalityFilter.has(m))) return false;
      }
      return true;
    });
  }, [flatModels, taskFilter, familyFilter, infraFilter, modalityFilter]);

  const hasActiveFilter =
    taskFilter.size > 0 || familyFilter.size > 0 || infraFilter.size > 0 || modalityFilter.size > 0;
  const clearFilters = () => {
    setTaskFilter(new Set());
    setFamilyFilter(new Set());
    setInfraFilter(new Set());
    setModalityFilter(new Set());
  };

  // 5) 刷新: 对每个 backend 调 refreshCapabilities, 再失效对应缓存.
  const onRefresh = async () => {
    if (refreshing || backendRefs.length === 0) return;
    setRefreshing(true);
    const settled = await Promise.allSettled(
      backendRefs.map((ref) =>
        mlBackendsApi.refreshCapabilities(ref.backend.project_id, ref.backend.id),
      ),
    );
    qc.invalidateQueries({ queryKey: ["ml-backend-capabilities"] });
    qc.invalidateQueries({ queryKey: ["admin", "ml-integrations", "overview"] });
    setRefreshing(false);
    const failed = settled.filter((s) => s.status === "rejected").length;
    pushToast(
      failed === 0
        ? { msg: `已重探 ${settled.length} 个 backend 能力目录`, kind: "success" }
        : { msg: `重探完成，${failed}/${settled.length} 个 backend 探测失败`, kind: "warning" },
    );
  };

  const anyCapLoading = results.some((r) => r.isLoading);

  return (
    <div className={styles.wrap}>
      <Card>
        <div className={styles.header}>
          <div className={styles.headerTitle}>
            <Icon name="layers" size={14} className={styles.mutedIcon} />
            <h3 className={styles.title}>能力目录</h3>
            <span className={styles.meta}>
              {flatModels.length} 个模型条目 · {backendRefs.length} 个 backend
            </span>
          </div>
          <Button
            size="sm"
            onClick={onRefresh}
            disabled={refreshing || backendRefs.length === 0}
            title="对所有 backend 重探 /setup 并刷新能力目录"
          >
            <Icon name="refresh" size={11} className={refreshing ? "spin" : undefined} />
            刷新
          </Button>
        </div>

        {overviewLoading ? (
          <div className={styles.note}>加载 backend 列表…</div>
        ) : overviewError ? (
          <div className={styles.noteError}>
            加载失败：{(overviewErr as Error)?.message ?? "未知错误"}
            <button className={styles.retryButton} onClick={() => refetchOverview()}>
              重试
            </button>
          </div>
        ) : backendRefs.length === 0 ? (
          <div className={styles.emptyState}>
            <Icon name="layers" size={28} className={styles.emptyIcon} />
            <div>尚无项目注册 ML Backend</div>
            <div className={styles.emptyHint}>在项目设置注册 backend 后, 其能力目录会出现在这里</div>
          </div>
        ) : (
          <>
            <FilterToolbar
              facets={facets}
              taskFilter={taskFilter}
              familyFilter={familyFilter}
              infraFilter={infraFilter}
              modalityFilter={modalityFilter}
              onToggleTask={(v) => setTaskFilter((s) => toggle(s, v))}
              onToggleFamily={(v) => setFamilyFilter((s) => toggle(s, v))}
              onToggleInfra={(v) => setInfraFilter((s) => toggle(s, v))}
              onToggleModality={(v) => setModalityFilter((s) => toggle(s, v))}
              hasActiveFilter={hasActiveFilter}
              onClear={clearFilters}
            />

            {/* 探测失败的 backend 降级提示 (能力目录可能缺条目). */}
            {results.some((r) => r.isError) && (
              <div className={styles.degradeBanner}>
                <Icon name="warning" size={13} />
                <span>
                  {results.filter((r) => r.isError).length} 个 backend 能力探测失败，其条目暂缺；点「刷新」可重探。
                </span>
              </div>
            )}

            {anyCapLoading && flatModels.length === 0 ? (
              <div className={styles.note}>探测各 backend 能力中…</div>
            ) : filtered.length === 0 ? (
              <div className={styles.emptyState}>
                <Icon name="filter" size={24} className={styles.emptyIcon} />
                <div>{hasActiveFilter ? "当前过滤条件无匹配模型" : "暂无可用模型条目"}</div>
                {hasActiveFilter && (
                  <button className={styles.retryButton} onClick={clearFilters}>
                    清除过滤
                  </button>
                )}
              </div>
            ) : (
              <div className={styles.grid}>
                {filtered.map((f) => (
                  <ModelCard key={`${f.backendId}:${f.model.id}`} item={f} />
                ))}
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

function toggle(set: Set<string>, value: string): Set<string> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

// ── 过滤工具栏 ──────────────────────────────────────────────────────────
interface FilterToolbarProps {
  facets: { tasks: string[]; families: string[]; infras: string[]; modalities: string[] };
  taskFilter: Set<string>;
  familyFilter: Set<string>;
  infraFilter: Set<string>;
  modalityFilter: Set<string>;
  onToggleTask: (v: string) => void;
  onToggleFamily: (v: string) => void;
  onToggleInfra: (v: string) => void;
  onToggleModality: (v: string) => void;
  hasActiveFilter: boolean;
  onClear: () => void;
}

function FilterToolbar(p: FilterToolbarProps) {
  const groups: {
    label: string;
    values: string[];
    active: Set<string>;
    toggle: (v: string) => void;
    render: (v: string) => string;
  }[] = [
    { label: "任务", values: p.facets.tasks, active: p.taskFilter, toggle: p.onToggleTask, render: taskLabel },
    { label: "模型族", values: p.facets.families, active: p.familyFilter, toggle: p.onToggleFamily, render: (v) => v },
    { label: "推理框架", values: p.facets.infras, active: p.infraFilter, toggle: p.onToggleInfra, render: infraLabel },
    { label: "模态", values: p.facets.modalities, active: p.modalityFilter, toggle: p.onToggleModality, render: modalityLabel },
  ];

  const anyFacet = groups.some((g) => g.values.length > 0);
  if (!anyFacet) return null;

  return (
    <div className={styles.toolbar}>
      {groups.map(
        (g) =>
          g.values.length > 0 && (
            <div key={g.label} className={styles.filterGroup}>
              <span className={styles.filterLabel}>{g.label}</span>
              <div className={styles.chipRow}>
                {g.values.map((v) => {
                  const on = g.active.has(v);
                  return (
                    <button
                      key={v}
                      type="button"
                      className={on ? `${styles.chip} ${styles.chipOn}` : styles.chip}
                      onClick={() => g.toggle(v)}
                      aria-pressed={on}
                    >
                      {g.render(v)}
                    </button>
                  );
                })}
              </div>
            </div>
          ),
      )}
      {p.hasActiveFilter && (
        <button type="button" className={styles.clearBtn} onClick={p.onClear}>
          <Icon name="x" size={11} />
          清除
        </button>
      )}
    </div>
  );
}

// ── 单个 model 卡片 ─────────────────────────────────────────────────────
function ModelCard({ item }: { item: FlatModel }) {
  const { model: m } = item;
  const infra = effectiveInfra(m, item.backendInfra);
  const modalities = effectiveModalities(m, item.backendModalities);
  const geom = m.supported_geometric_outputs ?? [];
  const attrs = m.output_attribute_types ?? [];
  const variantGroups = (m.supported_variants ?? []).filter(
    (g) => Array.isArray(g.variants) && g.variants.length > 0,
  );
  const resource = m.resource_profile ?? {};
  const resourceEntries = Object.entries(resource).filter(([, v]) => v != null);

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <span className={styles.modelName} title={m.display_name ?? m.id}>
          {m.display_name ?? m.id}
        </span>
        {item.stale && (
          <span title="来源 backend 当前未连接，目录可能为缓存旧值">
            <Badge variant="warning">缓存</Badge>
          </span>
        )}
      </div>

      <div className={styles.badgeRow}>
        {m.task && <Badge variant={taskVariant(m.task)}>{taskLabel(m.task)}</Badge>}
        {infra && <Badge variant="outline">{infraLabel(infra)}</Badge>}
        {modalities.map((mod) => (
          <Badge key={mod} variant="default">
            {modalityLabel(mod)}
          </Badge>
        ))}
        {m.is_interactive && <Badge variant="ai">交互式</Badge>}
        {m.model_family && (
          <span className={styles.familyChip} title="模型族">
            {m.model_family}
          </span>
        )}
      </div>

      <div className={styles.source} title={`${item.projectName} · ${item.backendName}`}>
        <Icon name="bot" size={11} className={styles.mutedIcon} />
        <span className={styles.sourceText}>
          {item.projectName} · {item.backendName}
        </span>
      </div>

      {geom.length > 0 && (
        <Row label="输出几何">
          {geom.map((g) => (
            <span key={g} className={styles.tag}>
              {g}
            </span>
          ))}
        </Row>
      )}

      {attrs.length > 0 && (
        <Row label="输出属性">
          {attrs.map((a) => (
            <span key={a} className={styles.tag}>
              {a}
            </span>
          ))}
        </Row>
      )}

      {variantGroups.length > 0 && (
        <div className={styles.variantBlock}>
          {variantGroups.map((g) => (
            <div key={g.key} className={styles.variantGroup}>
              <span className={styles.variantTitle}>{g.title ?? g.key}</span>
              <div className={styles.tagRow}>
                {g.variants!.map((v) => {
                  const metaBits = [
                    v.vram_gb != null ? `${v.vram_gb}GB` : null,
                    v.tier ? tierLabel(v.tier) : null,
                  ].filter(Boolean);
                  return (
                    <span
                      key={v.value}
                      className={v.recommended ? `${styles.variantPill} ${styles.variantOn}` : styles.variantPill}
                      title={v.note ?? undefined}
                    >
                      <span className="mono">{v.label ?? v.value}</span>
                      {metaBits.length > 0 && (
                        <span className={styles.variantMeta}> · {metaBits.join(" · ")}</span>
                      )}
                      {v.recommended && <span className={styles.variantStar}> ★</span>}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {resourceEntries.length > 0 && (
        <Row label="资源">
          {resourceEntries.map(([k, v]) => (
            <span key={k} className={styles.tag}>
              {k}: {String(v)}
            </span>
          ))}
        </Row>
      )}
    </div>
  );
}

function tierLabel(tier: string) {
  if (tier === "fast") return "快速";
  if (tier === "balanced") return "均衡";
  if (tier === "accurate") return "精度";
  return tier;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <div className={styles.tagRow}>{children}</div>
    </div>
  );
}
