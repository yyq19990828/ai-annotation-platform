// v0.14.9 · 模型市场「能力目录」面板 — 能力声明协议 v2 的消费视图.
// 与「项目级 ML Backend」表格不同, 这里按 *model 条目* 展开:
//   - 枚举所有项目已注册 backend (admin overview), 对每个 backend 拉 /capabilities 拿 models[];
//   - 每个 model 渲染一张卡片 (task/infra/modality badge + 输出几何 + 输出属性 + variants + resource);
//   - 老 backend (协议 v1) 由平台合成单 model, models 长度=1, 正常显示;
//   - 工具栏按 task / model_family / infra / modality 多选 chips 过滤;
//   - 「刷新」对每个 backend 调 refreshCapabilities 重探并刷新缓存.
// 仅消费已落地契约 (api/ml-backends.ts + adminMlIntegrations.ts), 不改 api / types.

import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
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
import {
  useProtocolCapabilities,
  useCapabilityInstances,
} from "@/api/mlCapabilities";
import { ProtocolCapabilityCard, type MountedModel } from "./ProtocolCapabilityCard";
import { EmptyCatalogBanner } from "./EmptyCatalogBanner";
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

type CatalogViewMode = "cards" | "list";
type CatalogGroupBy = "none" | "backend" | "task" | "infra";
type CatalogSort = "name" | "task" | "infra";

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
  const [searchParams, setSearchParams] = useSearchParams();
  const [refreshing, setRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState<CatalogViewMode>("cards");
  // v0.14.11 · 默认按协议能力 (task) 分组, 即使无 backend 注册也展示 9 张协议卡。
  const [groupBy, setGroupBy] = useState<CatalogGroupBy>("task");
  const [sortBy, setSortBy] = useState<CatalogSort>("name");
  const [search, setSearch] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // v0.14.11 · 协议级能力目录 (与 backend 注册解耦); 用作 groupBy=task 时的协议卡数据源。
  const { data: protocol } = useProtocolCapabilities();
  // v0.14.11 · 平台已知 backend 实例 (env-only + 项目级注册合并, 登录用户可访问);
  // 协议卡视图直接消费这个端点, 不再依赖 admin overview, 让普通用户也能看到 model 清单。
  const { data: instancesData } = useCapabilityInstances();

  const goToRegistry = () => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", "registry");
    setSearchParams(next, { replace: true });
  };

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
    const needle = search.trim().toLocaleLowerCase();
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
      if (needle) {
        const haystack = [
          f.model.display_name,
          f.model.id,
          f.model.model_family,
          f.model.task ? taskLabel(f.model.task) : "",
          f.backendName,
          f.projectName,
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [flatModels, taskFilter, familyFilter, infraFilter, modalityFilter, search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => compareModel(a, b, sortBy));
  }, [filtered, sortBy]);

  const grouped = useMemo(() => groupModels(sorted, groupBy), [groupBy, sorted]);

  // v0.14.11 · 协议卡视图: 遍历 protocol.tasks 渲染 9 张卡 (零接入也显示);
  // 数据源是 instances 端点 (env-only + 注册合并, 与 admin overview 完全解耦),
  // 按 model.task 挂到协议卡。search / taskFilter 同时作用于 task 卡过滤。
  const protocolView = useMemo(() => {
    if (!protocol) return null;
    const needle = search.trim().toLocaleLowerCase();
    const byTask = new Map<string, MountedModel[]>();
    for (const inst of instancesData?.instances ?? []) {
      const infraFallback = inst.infra && inst.infra !== "unknown" ? inst.infra : null;
      for (const m of inst.models) {
        if (infraFilter.size > 0) {
          const eff = m.infra ?? infraFallback;
          if (!eff || !infraFilter.has(eff)) continue;
        }
        if (modalityFilter.size > 0) {
          if (!m.modality || !modalityFilter.has(m.modality)) continue;
        }
        const taskId = m.task ?? "unknown";
        if (!byTask.has(taskId)) byTask.set(taskId, []);
        byTask.get(taskId)!.push({
          id: m.id,
          display_name: m.display_name,
          infra: m.infra ?? infraFallback,
          is_interactive: m.is_interactive,
          backendName: inst.name,
          source: inst.source,
        });
      }
    }
    return protocol.tasks
      .filter((task) => {
        if (taskFilter.size > 0 && !taskFilter.has(task.id)) return false;
        if (needle) {
          const meta = [task.label, task.id, task.summary, ...task.typical_models]
            .join(" ")
            .toLocaleLowerCase();
          if (!meta.includes(needle) && (byTask.get(task.id)?.length ?? 0) === 0) {
            return false;
          }
        }
        return true;
      })
      .map((task) => ({ task, mounted: byTask.get(task.id) ?? [] }));
  }, [protocol, instancesData, taskFilter, infraFilter, modalityFilter, search]);

  const hasActiveFilter =
    taskFilter.size > 0 ||
    familyFilter.size > 0 ||
    infraFilter.size > 0 ||
    modalityFilter.size > 0 ||
    Boolean(search.trim());
  const clearFilters = () => {
    setTaskFilter(new Set());
    setFamilyFilter(new Set());
    setInfraFilter(new Set());
    setModalityFilter(new Set());
    setSearch("");
  };
  const toggleGroup = (key: string) => {
    if (flatModels.length > 30) {
      setExpandedGroups((groups) => toggle(groups, key));
    } else {
      setCollapsedGroups((groups) => toggle(groups, key));
    }
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
        ) : backendRefs.length === 0 && groupBy !== "task" ? (
          // v0.14.11 · 0 backend + 非 task 分组: 沿用旧空态; task 分组下走协议卡视图。
          <div className={styles.emptyState}>
            <Icon name="layers" size={28} className={styles.emptyIcon} />
            <div>尚无项目注册 ML Backend</div>
            <div className={styles.emptyHint}>
              切到「分组: task」可查看平台协议层支持的全部能力；
              或在项目设置注册 backend 后, 其能力目录会出现在这里。
            </div>
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

            <div className={styles.catalogControls}>
              <label className={styles.searchBox}>
                <Icon name="search" size={13} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索模型、ID、模型族、任务或来源"
                  className={styles.searchInput}
                />
              </label>
              <div className={styles.segmented}>
                <button
                  type="button"
                  className={viewMode === "cards" ? `${styles.viewBtn} ${styles.viewBtnOn}` : styles.viewBtn}
                  onClick={() => setViewMode("cards")}
                  aria-pressed={viewMode === "cards"}
                  title="卡片视图"
                >
                  <Icon name="grid" size={13} />
                </button>
                <button
                  type="button"
                  className={viewMode === "list" ? `${styles.viewBtn} ${styles.viewBtnOn}` : styles.viewBtn}
                  onClick={() => setViewMode("list")}
                  aria-pressed={viewMode === "list"}
                  title="列表视图"
                >
                  <Icon name="list" size={13} />
                </button>
              </div>
              <label className={styles.selectLabel}>
                分组
                <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as CatalogGroupBy)}>
                  <option value="task">协议能力 (默认)</option>
                  <option value="backend">backend</option>
                  <option value="infra">infra</option>
                  <option value="none">不分组</option>
                </select>
              </label>
              {viewMode === "list" && (
                <label className={styles.selectLabel}>
                  排序
                  <select value={sortBy} onChange={(e) => setSortBy(e.target.value as CatalogSort)}>
                    <option value="name">模型名</option>
                    <option value="task">任务</option>
                    <option value="infra">infra</option>
                  </select>
                </label>
              )}
            </div>

            {/* 探测失败的 backend 降级提示 (能力目录可能缺条目). */}
            {results.some((r) => r.isError) && (
              <div className={styles.degradeBanner}>
                <Icon name="warning" size={13} />
                <span>
                  {results.filter((r) => r.isError).length} 个 backend 能力探测失败，其条目暂缺；点「刷新」可重探。
                </span>
              </div>
            )}

            {anyCapLoading && flatModels.length === 0 && groupBy !== "task" ? (
              <div className={styles.note}>探测各 backend 能力中…</div>
            ) : groupBy === "task" && protocolView ? (
              // v0.14.11 · 协议卡视图: 即使 sorted 为空也展示协议卡 (零接入引导)。
              <>
                {/* v0.14.11 · 横幅触发改为「所有协议卡都没有 model 挂载」(覆盖
                    env-only + 注册两条路径), 而非只看注册数。这样 docker-compose
                    自带的 gsam2 / sam3 在跑时就不会再误显示「未接入」横幅。 */}
                {protocolView.every((v) => v.mounted.length === 0) && (
                  <EmptyCatalogBanner
                    taskCount={protocolView.length}
                    onGoToRegistry={goToRegistry}
                  />
                )}
                {protocolView.length === 0 ? (
                  <div className={styles.emptyState}>
                    <Icon name="filter" size={24} className={styles.emptyIcon} />
                    <div>当前过滤条件无匹配能力</div>
                    {hasActiveFilter && (
                      <button className={styles.retryButton} onClick={clearFilters}>
                        清除过滤
                      </button>
                    )}
                  </div>
                ) : (
                  <div className={styles.groupedCatalog}>
                    {protocolView.map(({ task, mounted }) => (
                      <ProtocolCapabilityCard
                        key={task.id}
                        task={task}
                        mounted={mounted}
                        infraLabel={infraLabel}
                        modalityLabel={modalityLabel}
                        onGoToRegistry={goToRegistry}
                      />
                    ))}
                  </div>
                )}
              </>
            ) : sorted.length === 0 ? (
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
              <div className={styles.groupedCatalog}>
                {grouped.map((group) => {
                  const defaultCollapsed = flatModels.length > 30 && groupBy !== "none";
                  const collapsed =
                    groupBy !== "none" &&
                    (defaultCollapsed ? !expandedGroups.has(group.key) : collapsedGroups.has(group.key));
                  return (
                    <section key={group.key} className={styles.catalogGroup}>
                      {groupBy !== "none" && (
                        <button
                          type="button"
                          className={styles.groupHeader}
                          onClick={() => toggleGroup(group.key)}
                          aria-expanded={!collapsed}
                        >
                          <Icon name={collapsed ? "chevRight" : "chevDown"} size={13} />
                          <span>{group.label}</span>
                          <span className={styles.groupCount}>{group.items.length}</span>
                        </button>
                      )}
                      {!collapsed &&
                        (viewMode === "cards" ? (
                          <div className={styles.grid}>
                            {group.items.map((f) => (
                              <ModelCard key={`${f.backendId}:${f.model.id}`} item={f} />
                            ))}
                          </div>
                        ) : (
                          <ModelListTable items={group.items} />
                        ))}
                    </section>
                  );
                })}
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

function compareModel(a: FlatModel, b: FlatModel, sortBy: CatalogSort): number {
  if (sortBy === "task") {
    return (a.model.task ?? "").localeCompare(b.model.task ?? "") || compareModel(a, b, "name");
  }
  if (sortBy === "infra") {
    return (
      (effectiveInfra(a.model, a.backendInfra) ?? "").localeCompare(
        effectiveInfra(b.model, b.backendInfra) ?? "",
      ) || compareModel(a, b, "name")
    );
  }
  return (a.model.display_name ?? a.model.id).localeCompare(b.model.display_name ?? b.model.id);
}

function groupModels(items: FlatModel[], groupBy: CatalogGroupBy) {
  if (groupBy === "none") return [{ key: "all", label: "全部模型", items }];
  const map = new Map<string, { key: string; label: string; items: FlatModel[] }>();
  for (const item of items) {
    let key = "unknown";
    let label = "未知";
    if (groupBy === "backend") {
      key = item.backendId;
      label = `${item.projectName} · ${item.backendName}`;
    } else if (groupBy === "task") {
      key = item.model.task ?? "unknown";
      label = item.model.task ? taskLabel(item.model.task) : "未知任务";
    } else if (groupBy === "infra") {
      key = effectiveInfra(item.model, item.backendInfra) ?? "unknown";
      label = infraLabel(key);
    }
    if (!map.has(key)) map.set(key, { key, label, items: [] });
    map.get(key)!.items.push(item);
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
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

function ModelListTable({ items }: { items: FlatModel[] }) {
  return (
    <div className={styles.tableScroller}>
      <table className={styles.modelTable}>
        <thead>
          <tr>
            {["模型", "task", "infra", "模态", "输出几何", "variants", "来源", "状态"].map((head) => (
              <th key={head}>{head}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const m = item.model;
            const infra = effectiveInfra(m, item.backendInfra);
            const modalities = effectiveModalities(m, item.backendModalities);
            return (
              <tr key={`${item.backendId}:${m.id}`}>
                <td className={styles.modelCell}>
                  <div className={styles.modelCellName}>{m.display_name ?? m.id}</div>
                  <div className={`mono ${styles.modelCellId}`}>{m.id}</div>
                </td>
                <td>{m.task ? taskLabel(m.task) : "—"}</td>
                <td>{infra ? infraLabel(infra) : "—"}</td>
                <td>{modalities.length ? modalities.map(modalityLabel).join(" / ") : "—"}</td>
                <td className={styles.compactCell}>{(m.supported_geometric_outputs ?? []).join(" / ") || "—"}</td>
                <td className={styles.compactCell}>{variantSummary(m)}</td>
                <td className={styles.sourceCell}>
                  {item.projectName} · {item.backendName}
                </td>
                <td>{item.stale ? <Badge variant="warning">缓存</Badge> : <Badge variant="success">在线</Badge>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function variantSummary(model: MLModelCapability) {
  const groups = (model.supported_variants ?? []).filter(
    (group) => Array.isArray(group.variants) && group.variants.length > 0,
  );
  if (groups.length === 0) return "—";
  return groups
    .map((group) => `${group.title ?? group.key}:${group.variants?.length ?? 0}`)
    .join(" / ");
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
