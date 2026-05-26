import { useState, Fragment, useEffect } from "react";
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
import { useDatasets, useDatasetItems, useDatasetProjects, useUnlinkProject, useLinkProject, useScanDatasetItems, useBackfillDimensions, useBackfillMedia } from "@/hooks/useDatasets";
import { datasetsApi } from "@/api/datasets";
import { ImportDatasetWizard } from "@/components/datasets/ImportDatasetWizard";
import { StorageConnectionsPanel } from "@/components/connections/StorageConnectionsPanel";
import { useProjects } from "@/hooks/useProjects";
import { usePermissions } from "@/hooks/usePermissions";
import type { DatasetResponse } from "@/api/datasets";
import type { ProjectResponse } from "@/api/projects";
import type { IconName } from "@/components/ui/Icon";
import styles from "./DatasetsPage.module.css";

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
    <tr className={`${styles.datasetRow} ${isExpanded ? styles.datasetRowExpanded : ""}`} onClick={onToggle}>
      <td className={`${styles.datasetCell} ${styles.datasetNameCell}`}>
        <div className={styles.datasetIdentity}>
          <div className={styles.datasetIconBox}>
            <Icon name={TYPE_ICONS[ds.data_type] || "layers"} size={14} />
          </div>
          <div>
            <div className={styles.datasetName}>{ds.name}</div>
            <div className={styles.datasetMeta}>
              {ds.display_id}
              {ds.description && <> · {ds.description.length > 30 ? ds.description.slice(0, 30) + "…" : ds.description}</>}
            </div>
          </div>
        </div>
      </td>
      <td className={styles.datasetCell}>
        <Badge variant={TYPE_VARIANTS[ds.data_type] || "outline"}>
          <Icon name={TYPE_ICONS[ds.data_type] || "layers"} size={10} />
          {TYPE_LABELS[ds.data_type] || ds.data_type}
        </Badge>
      </td>
      <td className={styles.datasetCell}>
        <span className={`mono ${styles.monoCell}`}>{ds.file_count.toLocaleString()}</span>
      </td>
      <td className={styles.datasetCell}>
        <span className={`mono ${styles.monoCell}`}>{ds.project_count}</span>
      </td>
      <td className={styles.datasetCell}>
        <span className={styles.createdCell}>{created}</span>
      </td>
      <td className={`${styles.datasetCell} ${styles.datasetActionCell}`}>
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
  const queryClient = useQueryClient();
  const { data: itemsData, isLoading: itemsLoading } = useDatasetItems(ds.id, { limit: 10, offset: itemPage * 10 });
  const { data: linkedProjects = [] } = useDatasetProjects(ds.id);
  const { data: allProjects } = useProjects();
  const unlinkMutation = useUnlinkProject(ds.id);
  const linkMutation = useLinkProject(ds.id);
  const scanMutation = useScanDatasetItems(ds.id);
  const backfillMutation = useBackfillDimensions(ds.id);
  const backfillMediaMutation = useBackfillMedia(ds.id);
  const pushToast = useToastStore((s) => s.push);

  const items = itemsData?.items ?? [];
  const totalItems = itemsData?.total ?? 0;
  const totalPages = Math.ceil(totalItems / 10);
  const isImageDataset = ds.data_type === "image";
  const isVideoDataset = ds.data_type === "video";

  const linkedIds = new Set(linkedProjects.map((p) => p.id));
  const availableProjects = (allProjects ?? []).filter((p) => !linkedIds.has(p.id));

  return (
    <tr>
      <td colSpan={6} className={styles.detailCell}>
        <div className={styles.detailPanel}>
          <div className={styles.detailLayout}>
            {/* 文件列表 */}
            <div className={styles.filesColumn}>
              <div className={styles.detailHeader}>
                <h4 className={styles.detailTitle}>
                  文件列表 <span className={styles.detailCount}>({totalItems})</span>
                </h4>
                <div className={styles.buttonGroup}>
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
              <div className={styles.itemsTableScroller}>
                <table className={styles.itemsTable}>
                  <thead>
                    <tr>
                      {["文件名", "类型", "大小", "媒体信息", "上传时间"].map((h, i) => (
                        <th key={i} className={styles.itemsHeaderCell}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {itemsLoading && (
                      <tr><td colSpan={5} className={styles.emptyCell}>加载中...</td></tr>
                    )}
                    {!itemsLoading && items.map((item) => (
                      <tr key={item.id}>
                        <td className={styles.itemCell}>
                          <div className={styles.itemNameWrap}>
                            <Thumbnail src={item.thumbnail_url} blurhash={item.blurhash} width={32} height={32} />
                            <span className={styles.truncateFileName}>{item.file_name}</span>
                          </div>
                        </td>
                        <td className={styles.itemCell}>
                          <Badge variant="outline">{item.file_type}</Badge>
                        </td>
                        <td className={`${styles.itemCell} ${styles.mutedCell}`}>
                          {item.file_size ? `${(item.file_size / 1024).toFixed(1)} KB` : "—"}
                        </td>
                        <td
                          title={formatMediaInfo(item)}
                          className={`${styles.itemCell} ${styles.mediaInfo} ${formatMediaInfo(item).includes("失败") ? styles.dangerText : ""}`}
                        >
                          {formatMediaInfo(item)}
                        </td>
                        <td className={`${styles.itemCell} ${styles.mutedCell}`}>
                          {new Date(item.created_at).toLocaleDateString("zh-CN")}
                        </td>
                      </tr>
                    ))}
                    {!itemsLoading && items.length === 0 && (
                      <tr><td colSpan={5} className={styles.emptyCell}>暂无文件</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div className={styles.pagination}>
                  <Button size="sm" onClick={() => setItemPage(Math.max(0, itemPage - 1))} className={itemPage > 0 ? undefined : styles.invisible}>
                    <Icon name="chevLeft" size={11} />
                  </Button>
                  <span className={styles.pageIndicator}>
                    {itemPage + 1} / {totalPages}
                  </span>
                  <Button size="sm" onClick={() => setItemPage(Math.min(totalPages - 1, itemPage + 1))} className={itemPage < totalPages - 1 ? undefined : styles.invisible}>
                    <Icon name="chevRight" size={11} />
                  </Button>
                </div>
              )}
            </div>

            {/* 关联项目 */}
            <div className={styles.projectsColumn}>
              <div className={styles.detailHeader}>
                <h4 className={styles.detailTitle}>
                  关联项目 <span className={styles.detailCount}>({linkedProjects.length})</span>
                </h4>
              </div>
              {linkedProjects.map((p) => (
                <div key={p.id} className={styles.projectRow}>
                  <div>
                    <div className={styles.projectName}>{p.name}</div>
                    <div className={styles.projectMeta}>{p.display_id} · {p.type_label}</div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmUnlink(p)} title="取消关联">
                    <Icon name="x" size={11} />
                  </Button>
                </div>
              ))}
              {linkedProjects.length === 0 && (
                <div className={styles.emptyProject}>未关联任何项目</div>
              )}
              {availableProjects.length > 0 && (
                <select
                  onChange={(e) => {
                    if (e.target.value) {
                      linkMutation.mutate(e.target.value);
                      e.target.value = "";
                    }
                  }}
                  defaultValue=""
                  className={styles.projectSelect}
                >
                  <option value="" disabled>关联到项目...</option>
                  {availableProjects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.display_id})</option>
                  ))}
                </select>
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
      <div className={styles.confirmBody}>
        <p className={styles.confirmParagraph}>
          确认取消数据集 <strong>{datasetName}</strong> 与项目 <strong>{project.name}</strong> 的关联？
        </p>
        <div className={styles.confirmPreview}>
          {preview === null ? (
            "正在统计影响范围…"
          ) : preview.tasks === 0 ? (
            "项目中没有由该数据集创建的任务，可放心取消。"
          ) : (
            <>
              <strong className={styles.dangerText}>将一并删除</strong>项目中由该数据集创建的 <strong>{preview.tasks}</strong> 个任务
              {preview.annotations > 0 && (
                <>（含 <strong className={styles.dangerText}>{preview.annotations}</strong> 个已有标注）</>
              )}
              {preview.batches > 0 && (
                <>，并清理 <strong className={styles.dangerText}>{preview.batches}</strong> 个失去全部任务的空批次</>
              )}
              。<br />此操作不可恢复。
            </>
          )}
        </div>
        {dangerous && (
          <div className={styles.confirmInputGroup}>
            <label className={styles.confirmLabel}>
              请输入数据集名称 <strong>{datasetName}</strong> 以确认：
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={datasetName}
              autoFocus
              className={`${styles.confirmInput} ${canSubmit ? styles.confirmInputReady : ""}`}
            />
          </div>
        )}
        <div className={styles.modalActions}>
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
  const totalFiles = datasets.reduce((sum, ds) => sum + ds.file_count, 0);
  const linkedCount = datasets.filter((ds) => (ds.project_count ?? 0) > 0).length;

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>数据集</h1>
          <p className={styles.subtitle}>管理标注数据集，上传文件并关联到标注项目</p>
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
      <div className={styles.pageTabs}>
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
          <div className={styles.statsGrid}>
            <StatCard icon="layers" label="数据集总数" value={total.toLocaleString()} />
            <StatCard icon="image" label="文件总量" value={totalFiles.toLocaleString()} />
            <StatCard icon="folder" label="已关联项目" value={String(linkedCount)} />
            <StatCard icon="db" label="存储后端" value="MinIO" />
          </div>

          {/* Main table */}
          <Card>
            <div className={styles.tableToolbar}>
              <div className={styles.toolbarLeft}>
                <h3 className={styles.sectionTitle}>全部数据集</h3>
                <TabRow tabs={[...TYPE_FILTERS]} active={filter} onChange={setFilter} />
              </div>
              <SearchInput placeholder="搜索数据集..." value={query} onChange={setQuery} width={220} />
            </div>
            <div className={styles.tableScroller}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    {["数据集", "类型", "文件数", "关联项目", "创建时间", ""].map((h, i) => (
                      <th key={i} className={styles.headerCell}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {isLoading && (
                    <tr><td colSpan={6} className={`${styles.emptyCell} ${styles.emptyCellLarge}`}>加载中...</td></tr>
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
                    <tr><td colSpan={6} className={`${styles.emptyCell} ${styles.emptyCellLarge}`}>
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
