import { useState, Fragment, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Thumbnail } from "@/components/Thumbnail";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { SearchInput } from "@/components/ui/SearchInput";
import { TabRow } from "@/components/ui/TabRow";
import { useToastStore } from "@/components/ui/Toast";
import { useQueryClient } from "@tanstack/react-query";
import { useDatasets, useDatasetItems, useDatasetProjects, useUnlinkProject, useLinkProject, useScanDatasetItems, useBackfillDimensions, useBackfillMedia, useUpdateDataset } from "@/hooks/useDatasets";
import { datasetsApi } from "@/api/datasets";
import { ImportDatasetWizard } from "@/components/datasets/ImportDatasetWizard";
import { LinkJobProgress } from "@/components/datasets/LinkJobProgress";
import { StorageConnectionsPanel } from "@/components/connections/StorageConnectionsPanel";
import { AxisConventionPicker } from "@/components/datasets/AxisConventionPicker";
import { useProjects } from "@/hooks/useProjects";
import { usePermissions } from "@/hooks/usePermissions";
import type { DatasetResponse } from "@/api/datasets";
import type { ProjectResponse } from "@/api/projects";
import type { IconName } from "@/components/ui/Icon";
import type { LidarAxisConvention } from "@/pages/Workbench/stages/three-d/geometry/axisConvention";

const TYPE_LABELS: Record<string, string> = {
  image: "图像",
  video: "视频",
  point_cloud: "3D 点云",
  multimodal: "多模态",
  other: "其他",
};

const TYPE_ICONS: Record<string, IconName> = {
  image: "image",
  video: "video",
  point_cloud: "cube",
  multimodal: "mm",
  other: "layers",
};

const TYPE_VARIANTS: Record<string, "accent" | "ai" | "warning" | "success" | "outline"> = {
  image: "accent",
  video: "ai",
  point_cloud: "warning",
  multimodal: "success",
  other: "outline",
};

const TYPE_FILTERS = ["全部", "图像", "视频", "3D", "多模态"] as const;
const FILTER_MAP: Record<string, string | undefined> = {
  "全部": undefined,
  "图像": "image",
  "视频": "video",
  "3D": "point_cloud",
  "多模态": "multimodal",
};

// 主表头单元 / 文件子表头单元
const TH_CLASS =
  "border-b border-border bg-muted px-3 py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap first:pl-4 last:pr-4";
const ITEMS_TH_CLASS =
  "border-b border-border bg-muted px-2 py-1.5 text-left text-[11px] font-medium text-muted-foreground whitespace-nowrap";
const TD_CLASS = "border-b border-border p-3 align-middle whitespace-nowrap";
const ITEM_TD_CLASS = "border-b border-border p-2 whitespace-nowrap";
const DETAIL_TITLE_CLASS = "m-0 text-[13px] font-semibold text-foreground";
const DETAIL_HEADER_CLASS = "mb-2.5 flex items-center justify-between";

function getErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : "未知错误";
}

function getVideoMeta(item: { metadata: Record<string, unknown> }) {
  const video = item.metadata?.video;
  return video && typeof video === "object" ? video as Record<string, unknown> : null;
}

function formatMediaInfo(item: { file_type: string; width: number | null; height: number | null; metadata: Record<string, unknown> }) {
  if (item.file_type === "image") {
    return item.width && item.height ? `${item.width}×${item.height}` : "待回填";
  }
  if (item.file_type === "video") {
    const video = getVideoMeta(item);
    if (!video) return "元数据生成中";
    const probeError = typeof video.probe_error === "string" ? video.probe_error : "";
    if (probeError) return `解析失败: ${probeError}`;
    const w = typeof video.width === "number" ? video.width : item.width;
    const h = typeof video.height === "number" ? video.height : item.height;
    const fps = typeof video.fps === "number" ? `${video.fps}fps` : "";
    const frames = typeof video.frame_count === "number" ? `${video.frame_count}帧` : "";
    const codec = typeof video.codec === "string" ? video.codec : "";
    const dims = w && h ? `${w}×${h}` : "";
    return [dims, fps, frames, codec].filter(Boolean).join(" · ") || "元数据生成中";
  }
  return "—";
}

function DatasetRow({ ds, isExpanded, onToggle }: { ds: DatasetResponse; isExpanded: boolean; onToggle: () => void }) {
  const created = new Date(ds.created_at).toLocaleDateString("zh-CN");
  return (
    <tr
      id={`dataset-row-${ds.id}`}
      className={`cursor-pointer ${isExpanded ? "bg-muted" : ""}`}
      onClick={onToggle}
    >
      <td className={`${TD_CLASS} pl-4`}>
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
            <Icon name={TYPE_ICONS[ds.data_type] || "layers"} size={14} />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[13.5px] font-medium">{ds.name}</div>
            <div className="mt-px truncate text-[11px] text-muted-foreground">
              {ds.display_id}
              {ds.description && <> · {ds.description.length > 30 ? ds.description.slice(0, 30) + "…" : ds.description}</>}
            </div>
          </div>
        </div>
      </td>
      <td className={TD_CLASS}>
        <Badge variant={TYPE_VARIANTS[ds.data_type] || "outline"}>
          <Icon name={TYPE_ICONS[ds.data_type] || "layers"} size={10} />
          {TYPE_LABELS[ds.data_type] || ds.data_type}
        </Badge>
      </td>
      <td className={TD_CLASS}>
        <Badge variant={ds.has_scenes ? "success" : "outline"}>
          <Icon name="layers" size={10} />
          {ds.has_scenes ? "含 Scene" : "无 Scene"}
        </Badge>
      </td>
      <td className={TD_CLASS}>
        <span className="mono text-[13px]">{ds.file_count.toLocaleString()}</span>
      </td>
      <td className={TD_CLASS}>
        <span className="mono text-[13px]">{ds.project_count}</span>
      </td>
      <td className={TD_CLASS}>
        <span className="text-[12.5px]">{created}</span>
      </td>
      <td className={`${TD_CLASS} pr-4 text-right`}>
        <Button size="sm">
          {isExpanded ? "收起" : "展开"} <Icon name={isExpanded ? "chevDown" : "chevRight"} size={11} />
        </Button>
      </td>
    </tr>
  );
}

function DatasetDetail({ ds }: { ds: DatasetResponse }) {
  const [itemPage, setItemPage] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState<ProjectResponse | null>(null);
  // v0.12.0 · 大 dataset 关联后异步建 task 的进度
  const [linkJob, setLinkJob] = useState<{ jobId: string; projectId: string } | null>(null);
  const queryClient = useQueryClient();
  const { data: itemsData, isLoading: itemsLoading } = useDatasetItems(ds.id, { limit: 10, offset: itemPage * 10 });
  const { data: linkedProjects = [] } = useDatasetProjects(ds.id);
  const { data: allProjects } = useProjects();
  const unlinkMutation = useUnlinkProject(ds.id);
  const linkMutation = useLinkProject(ds.id);
  const scanMutation = useScanDatasetItems(ds.id);
  const backfillMutation = useBackfillDimensions(ds.id);
  const backfillMediaMutation = useBackfillMedia(ds.id);
  const updateDataset = useUpdateDataset();
  const pushToast = useToastStore((s) => s.push);

  const items = itemsData?.items ?? [];
  const totalItems = itemsData?.total ?? 0;
  const totalPages = Math.ceil(totalItems / 10);
  const isImageDataset = ds.data_type === "image";
  const isVideoDataset = ds.data_type === "video";
  const isPointCloudDataset = ds.data_type === "point_cloud";

  const linkedIds = new Set(linkedProjects.map((p) => p.id));
  const availableProjects = (allProjects ?? []).filter((p) => !linkedIds.has(p.id));
  const handleAxisConventionChange = (next: LidarAxisConvention) => {
    const current = ds.axis_convention ?? "iso_8855";
    if (next === current || updateDataset.isPending) return;
    if (isPointCloudDataset && (ds.project_count ?? 0) > 0) {
      const ok = window.confirm(
        "该数据集已关联项目。若已有 3D 标注，切换坐标系后历史标注可能与点云不一致。确认继续？",
      );
      if (!ok) return;
    }
    updateDataset.mutate(
      { id: ds.id, payload: { axis_convention: next } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["dataset", ds.id] });
          pushToast({ msg: "坐标系约定已更新" });
        },
        onError: (err: Error) => {
          pushToast({ msg: "坐标系更新失败", sub: err.message, kind: "error" });
        },
      },
    );
  };

  return (
    <tr>
      <td colSpan={7} className="border-b border-border p-0 whitespace-normal">
        <div className="bg-background px-5 py-4">
          <div className="flex gap-4">
            {/* 文件列表 */}
            <div className="min-w-0 flex-[2]">
              <div className={DETAIL_HEADER_CLASS}>
                <h4 className={DETAIL_TITLE_CLASS}>
                  文件列表 <span className="font-normal text-muted-foreground">({totalItems})</span>
                </h4>
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    onClick={() => {
                      scanMutation.mutate(undefined, {
                        onSuccess: (res) => {
                          pushToast({
                            msg: res.new_items > 0
                              ? `扫描完成，新增 ${res.new_items} 个文件`
                              : "扫描完成，无新文件",
                          });
                        },
                      });
                    }}
                    disabled={scanMutation.isPending}
                  >
                    <Icon name="refresh" size={12} /> {scanMutation.isPending ? "扫描中..." : "扫描导入"}
                  </Button>
                  {isImageDataset && (
                    <Button
                      size="sm"
                      onClick={() => {
                        backfillMutation.mutate(undefined, {
                          onSuccess: (res) => {
                            pushToast({
                              msg: `回填完成 · 处理 ${res.processed} / 失败 ${res.failed}` +
                                (res.remaining_hint ? "，仍有未处理项，可再次点击" : ""),
                            });
                          },
                          onError: (err: unknown) => {
                            pushToast({ msg: `回填失败: ${getErrorMessage(err)}`, kind: "error" });
                          },
                        });
                      }}
                      disabled={backfillMutation.isPending}
                      title="对缺失 width/height 的图片执行维度回填"
                    >
                      <Icon name="refresh" size={12} /> {backfillMutation.isPending ? "回填中..." : "回填维度"}
                    </Button>
                  )}
                  {isVideoDataset && (
                    <Button
                      size="sm"
                      onClick={() => {
                        backfillMediaMutation.mutate(undefined, {
                          onSuccess: () => {
                            pushToast({ msg: "已提交视频元数据补生成任务", sub: "稍后刷新文件列表可查看处理结果" });
                          },
                          onError: (err: unknown) => {
                            pushToast({ msg: `提交失败: ${getErrorMessage(err)}`, kind: "error" });
                          },
                        });
                      }}
                      disabled={backfillMediaMutation.isPending}
                      title="对缺失视频元数据、poster 或播放转码结果的文件重新入队"
                    >
                      <Icon name="refresh" size={12} /> {backfillMediaMutation.isPending ? "提交中..." : "补生成元数据"}
                    </Button>
                  )}
                  <Button size="sm" onClick={() => setUploadOpen(true)}>
                    <Icon name="upload" size={12} /> 上传
                  </Button>
                  <ImportDatasetWizard
                    open={uploadOpen}
                    onClose={() => setUploadOpen(false)}
                    datasetId={ds.id}
                    datasetName={ds.name}
                    onUploaded={() => {
                      queryClient.invalidateQueries({ queryKey: ["datasets"] });
                      queryClient.invalidateQueries({ queryKey: ["dataset-items", ds.id] });
                      queryClient.invalidateQueries({ queryKey: ["tasks"] });
                      queryClient.invalidateQueries({ queryKey: ["projects"] });
                      queryClient.invalidateQueries({ queryKey: ["project-stats"] });
                    }}
                  />

                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-separate border-spacing-0 text-[12.5px]">
                  <thead>
                    <tr>
                      {["文件名", "类型", "大小", "媒体信息", "上传时间"].map((h, i) => (
                        <th key={i} className={ITEMS_TH_CLASS}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {itemsLoading && (
                      <tr><td colSpan={5} className="p-5 text-center text-muted-foreground">加载中...</td></tr>
                    )}
                    {!itemsLoading && items.map((item) => (
                      <tr key={item.id}>
                        <td className={ITEM_TD_CLASS}>
                          <div className="flex min-w-0 items-center gap-2">
                            <Thumbnail src={item.thumbnail_url} blurhash={item.blurhash} width={32} height={32} />
                            <span className="max-w-[240px] truncate">{item.file_name}</span>
                          </div>
                        </td>
                        <td className={ITEM_TD_CLASS}>
                          <Badge variant="outline">{item.file_type}</Badge>
                        </td>
                        <td className={`${ITEM_TD_CLASS} text-muted-foreground`}>
                          {item.file_size ? `${(item.file_size / 1024).toFixed(1)} KB` : "—"}
                        </td>
                        <td
                          title={formatMediaInfo(item)}
                          className={`${ITEM_TD_CLASS} max-w-[220px] truncate ${formatMediaInfo(item).includes("失败") ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground"}`}
                        >
                          {formatMediaInfo(item)}
                        </td>
                        <td className={`${ITEM_TD_CLASS} text-muted-foreground`}>
                          {new Date(item.created_at).toLocaleDateString("zh-CN")}
                        </td>
                      </tr>
                    ))}
                    {!itemsLoading && items.length === 0 && (
                      <tr><td colSpan={5} className="p-5 text-center text-muted-foreground">暂无文件</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div className="mt-2 flex justify-center gap-1">
                  <Button size="sm" onClick={() => setItemPage(Math.max(0, itemPage - 1))} className={itemPage > 0 ? undefined : "invisible"}>
                    <Icon name="chevLeft" size={11} />
                  </Button>
                  <span className="px-2 py-1 text-[11px] text-muted-foreground">
                    {itemPage + 1} / {totalPages}
                  </span>
                  <Button size="sm" onClick={() => setItemPage(Math.min(totalPages - 1, itemPage + 1))} className={itemPage < totalPages - 1 ? undefined : "invisible"}>
                    <Icon name="chevRight" size={11} />
                  </Button>
                </div>
              )}
            </div>

            {/* 关联项目 */}
            <div className="min-w-[220px] flex-1 border-l border-border pl-4">
              <div className="mb-3.5 border-b border-border pb-3.5">
                <div className={DETAIL_HEADER_CLASS}>
                  <h4 className={DETAIL_TITLE_CLASS}>Scene 信息</h4>
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-muted-foreground">Scene</span>
                    <Badge variant={ds.has_scenes ? "success" : "outline"}>
                      {ds.has_scenes ? "已识别" : "未识别"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-muted-foreground">时序声明</span>
                    <Badge variant={ds.is_temporal ? "accent" : "outline"}>
                      {ds.is_temporal ? "时序数据集" : "普通数据集"}
                    </Badge>
                  </div>
                </div>
              </div>
              {isPointCloudDataset && (
                <div className="mb-3.5 border-b border-border pb-3.5">
                  <div className={DETAIL_HEADER_CLASS}>
                    <h4 className={DETAIL_TITLE_CLASS}>点云坐标系</h4>
                  </div>
                  <AxisConventionPicker
                    value={ds.axis_convention}
                    datasetId={ds.id}
                    disabled={updateDataset.isPending}
                    onChange={handleAxisConventionChange}
                  />
                </div>
              )}
              <div className={DETAIL_HEADER_CLASS}>
                <h4 className={DETAIL_TITLE_CLASS}>
                  关联项目 <span className="font-normal text-muted-foreground">({linkedProjects.length})</span>
                </h4>
              </div>
              {linkedProjects.map((p) => (
                <div key={p.id} className="flex items-center justify-between border-b border-border py-2">
                  <div className="min-w-0">
                    <div className="truncate text-[12.5px] font-medium text-foreground">{p.name}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{p.display_id} · {p.type_label}</div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmUnlink(p)} title="取消关联">
                    <Icon name="x" size={11} />
                  </Button>
                </div>
              ))}
              {linkedProjects.length === 0 && (
                <div className="py-3 text-xs text-muted-foreground">未关联任何项目</div>
              )}
              {availableProjects.length > 0 && (
                <select
                  onChange={(e) => {
                    const projectId = e.target.value;
                    if (projectId) {
                      linkMutation.mutate(projectId, {
                        onSuccess: (res) => {
                          if (res.async_job_id) {
                            setLinkJob({ jobId: res.async_job_id, projectId });
                          }
                        },
                      });
                      e.target.value = "";
                    }
                  }}
                  defaultValue=""
                  className="mt-2 w-full cursor-pointer appearance-none rounded-sm border border-border bg-card px-2 py-1.5 text-xs text-foreground"
                >
                  <option value="" disabled>关联到项目...</option>
                  {availableProjects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.display_id})</option>
                  ))}
                </select>
              )}
              {linkJob && (
                <LinkJobProgress
                  jobId={linkJob.jobId}
                  projectId={linkJob.projectId}
                  onDone={() => setLinkJob(null)}
                />
              )}
            </div>
          </div>

          {confirmUnlink && (
            <UnlinkConfirmModal
              datasetId={ds.id}
              datasetName={ds.name}
              project={confirmUnlink}
              onClose={() => setConfirmUnlink(null)}
              onConfirm={() => {
                unlinkMutation.mutate(confirmUnlink.id, {
                  onSuccess: (res) => {
                    const parts: string[] = [];
                    if (res?.deleted_tasks) parts.push(`${res.deleted_tasks} 个任务`);
                    if (res?.deleted_annotations) parts.push(`${res.deleted_annotations} 个标注`);
                    if (res?.deleted_batches) parts.push(`${res.deleted_batches} 个空批次`);
                    pushToast({
                      msg: "已取消关联",
                      sub: parts.length ? `已清理 ${parts.join(" · ")}` : undefined,
                    });
                    setConfirmUnlink(null);
                  },
                  onError: (err: Error) => pushToast({ msg: "取消关联失败", sub: err.message, kind: "error" }),
                });
              }}
            />
          )}
        </div>
      </td>
    </tr>
  );
}

function UnlinkConfirmModal({
  datasetId,
  datasetName,
  project,
  onClose,
  onConfirm,
}: {
  datasetId: string;
  datasetName: string;
  project: ProjectResponse;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [preview, setPreview] = useState<{ tasks: number; annotations: number; batches: number } | null>(null);
  // v0.7.0：删除强度对齐 DangerSection — 必须输入数据集名称才能确认
  const [confirmText, setConfirmText] = useState("");
  const dangerous = (preview?.tasks ?? 0) > 0;
  const canSubmit = dangerous ? confirmText.trim() === datasetName : true;

  useEffect(() => {
    let cancelled = false;
    datasetsApi.previewUnlink(datasetId, project.id)
      .then((r) => {
        if (!cancelled) setPreview({
          tasks: r.will_delete_tasks,
          annotations: r.will_delete_annotations,
          batches: r.will_delete_batches,
        });
      })
      .catch(() => { if (!cancelled) setPreview({ tasks: 0, annotations: 0, batches: 0 }); });
    return () => { cancelled = true; };
  }, [datasetId, project.id]);

  return (
    <Modal open onClose={onClose} title="确认取消关联">
      <div className="text-[13px] leading-relaxed">
        <p className="mb-2">
          确认取消数据集 <strong>{datasetName}</strong> 与项目 <strong>{project.name}</strong> 的关联？
        </p>
        <div className="mb-2 text-muted-foreground">
          {preview === null ? (
            "正在统计影响范围…"
          ) : preview.tasks === 0 ? (
            "项目中没有由该数据集创建的任务，可放心取消。"
          ) : (
            <>
              <strong className="text-rose-600 dark:text-rose-400">将一并删除</strong>项目中由该数据集创建的 <strong>{preview.tasks}</strong> 个任务
              {preview.annotations > 0 && (
                <>（含 <strong className="text-rose-600 dark:text-rose-400">{preview.annotations}</strong> 个已有标注）</>
              )}
              {preview.batches > 0 && (
                <>，并清理 <strong className="text-rose-600 dark:text-rose-400">{preview.batches}</strong> 个失去全部任务的空批次</>
              )}
              。<br />此操作不可恢复。
            </>
          )}
        </div>
        {dangerous && (
          <div className="my-2.5">
            <label className="mb-1 block text-xs text-muted-foreground">
              请输入数据集名称 <strong>{datasetName}</strong> 以确认：
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={datasetName}
              autoFocus
              className={`box-border w-full appearance-none rounded-md border bg-muted px-2.5 py-[7px] text-[13px] text-foreground [font:inherit] ${canSubmit ? "border-emerald-500" : "border-border"}`}
            />
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={onClose}>取消</Button>
          <Button
            onClick={onConfirm}
            disabled={!canSubmit}
            variant={canSubmit ? "danger" : "default"}
          >
            确认删除并取消关联
          </Button>
        </div>
      </div>
    </Modal>
  );
}

const PAGE_TABS = ["数据集管理", "数据连接器"] as const;

export function DatasetsPage() {
  const [activeTab, setActiveTab] = useState<string>("数据集管理");
  const [filter, setFilter] = useState<string>("全部");
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showConnForm, setShowConnForm] = useState(false);
  const { role } = usePermissions();
  const canManageConn = role === "super_admin" || role === "project_admin";
  const queryClient = useQueryClient();

  const { data: datasetsData, isLoading } = useDatasets({
    search: query || undefined,
    data_type: FILTER_MAP[filter],
  });

  const datasets = datasetsData?.items ?? [];
  const total = datasetsData?.total ?? 0;

  // 从通知点入（/datasets?dataset=<id>）时，自动切到「数据集管理」并展开、滚动到该数据集
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const target = searchParams.get("dataset");
    if (!target || isLoading) return;
    if (!datasets.some((ds) => ds.id === target)) return;
    setActiveTab("数据集管理");
    setExpandedId(target);
    requestAnimationFrame(() => {
      document
        .getElementById(`dataset-row-${target}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    // 用过即清掉 query，避免刷新/再渲染时反复跳转
    searchParams.delete("dataset");
    setSearchParams(searchParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, isLoading, datasets]);
  const totalFiles = datasets.reduce((sum, ds) => sum + ds.file_count, 0);
  const linkedCount = datasets.filter((ds) => (ds.project_count ?? 0) > 0).length;

  return (
    <div className="tw-scope mx-auto max-w-[1480px] px-7 pb-10 pt-5 text-foreground">
      {/* Header */}
      <div className="mb-5 flex items-end justify-between gap-6">
        <div>
          <h1 className="mb-1 text-xl font-semibold">数据集</h1>
          <p className="text-[13px] text-muted-foreground">管理标注数据集，上传文件并关联到标注项目</p>
        </div>
        {activeTab === "数据集管理" && (
          <Button variant="primary" onClick={() => setShowCreate(true)}>
            <Icon name="plus" size={13} /> 新建数据集
          </Button>
        )}
        {activeTab === "数据连接器" && canManageConn && (
          <Button variant="primary" onClick={() => setShowConnForm(true)}>
            <Icon name="plus" size={13} /> 新建数据源
          </Button>
        )}
      </div>

      {/* Page tabs */}
      <div className="mb-5">
        <TabRow tabs={[...PAGE_TABS]} active={activeTab} onChange={setActiveTab} />
      </div>

      {/* Create dataset wizard：新建数据集 + 上传/导入文件 */}
      <ImportDatasetWizard
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onUploaded={() => {
          queryClient.invalidateQueries({ queryKey: ["datasets"] });
          queryClient.invalidateQueries({ queryKey: ["tasks"] });
          queryClient.invalidateQueries({ queryKey: ["projects"] });
          queryClient.invalidateQueries({ queryKey: ["project-stats"] });
        }}
      />

      {activeTab === "数据连接器" ? (
        <StorageConnectionsPanel
          showForm={showConnForm}
          onShowFormChange={setShowConnForm}
          hideHeaderAction
        />
      ) : (
        <>
          {/* Stats */}
          <div className="mb-5 grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
            <StatCard icon="layers" label="数据集总数" value={total.toLocaleString()} />
            <StatCard icon="image" label="文件总量" value={totalFiles.toLocaleString()} />
            <StatCard icon="folder" label="已关联项目" value={String(linkedCount)} />
            <StatCard icon="db" label="存储后端" value="MinIO" />
          </div>

          {/* Main table */}
          <Card>
            <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
              <div className="flex items-center gap-3">
                <h3 className="m-0 text-sm font-semibold">全部数据集</h3>
                <TabRow tabs={[...TYPE_FILTERS]} active={filter} onChange={setFilter} />
              </div>
              <SearchInput placeholder="搜索数据集..." value={query} onChange={setQuery} width={220} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-separate border-spacing-0 text-[13px]">
                <thead>
                  <tr>
                    {["数据集", "类型", "Scene", "文件数", "关联项目", "创建时间", ""].map((h, i) => (
                      <th key={i} className={TH_CLASS}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {isLoading && (
                    <tr><td colSpan={7} className="p-10 text-center text-muted-foreground">加载中...</td></tr>
                  )}
                  {!isLoading && datasets.map((ds) => (
                    <Fragment key={ds.id}>
                      <DatasetRow
                        ds={ds}
                        isExpanded={expandedId === ds.id}
                        onToggle={() => setExpandedId(expandedId === ds.id ? null : ds.id)}
                      />
                      {expandedId === ds.id && <DatasetDetail ds={ds} />}
                    </Fragment>
                  ))}
                  {!isLoading && datasets.length === 0 && (
                    <tr><td colSpan={7} className="p-10 text-center text-muted-foreground">
                      {query || filter !== "全部" ? "没有匹配的数据集" : '暂无数据集，点击「新建数据集」开始'}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
