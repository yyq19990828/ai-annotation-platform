import { useState, Fragment } from "react";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { SearchInput } from "@/components/ui/SearchInput";
import { TabRow } from "@/components/ui/TabRow";
import { useToastStore } from "@/components/ui/Toast";
import { useDatasets, useDatasetItems, useCreateDataset, useDatasetProjects, useUnlinkProject, useLinkProject, useScanDatasetItems } from "@/hooks/useDatasets";
import { useProjects } from "@/hooks/useProjects";
import type { DatasetResponse } from "@/api/datasets";
import type { IconName } from "@/components/ui/Icon";

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

function DatasetRow({ ds, isExpanded, onToggle }: { ds: DatasetResponse; isExpanded: boolean; onToggle: () => void }) {
  const created = new Date(ds.created_at).toLocaleDateString("zh-CN");
  return (
    <tr onClick={onToggle} style={{ cursor: "pointer", background: isExpanded ? "var(--color-bg-sunken)" : undefined }}>
      <td style={{ padding: "12px 12px 12px 16px", borderBottom: "1px solid var(--color-border)", verticalAlign: "middle" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 6,
            background: "var(--color-bg-sunken)", border: "1px solid var(--color-border)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "var(--color-fg-muted)", flex: "0 0 28px",
          }}>
            <Icon name={TYPE_ICONS[ds.data_type] || "layers"} size={14} />
          </div>
          <div>
            <div style={{ fontWeight: 500, fontSize: 13.5 }}>{ds.name}</div>
            <div style={{ fontSize: 11, color: "var(--color-fg-subtle)", marginTop: 1 }}>
              {ds.display_id}
              {ds.description && <> · {ds.description.length > 30 ? ds.description.slice(0, 30) + "…" : ds.description}</>}
            </div>
          </div>
        </div>
      </td>
      <td style={{ padding: 12, borderBottom: "1px solid var(--color-border)", verticalAlign: "middle" }}>
        <Badge variant={TYPE_VARIANTS[ds.data_type] || "outline"}>
          <Icon name={TYPE_ICONS[ds.data_type] || "layers"} size={10} />
          {TYPE_LABELS[ds.data_type] || ds.data_type}
        </Badge>
      </td>
      <td style={{ padding: 12, borderBottom: "1px solid var(--color-border)", verticalAlign: "middle" }}>
        <span className="mono" style={{ fontSize: 13 }}>{ds.file_count.toLocaleString()}</span>
      </td>
      <td style={{ padding: 12, borderBottom: "1px solid var(--color-border)", verticalAlign: "middle" }}>
        <span className="mono" style={{ fontSize: 13 }}>{ds.project_count}</span>
      </td>
      <td style={{ padding: 12, borderBottom: "1px solid var(--color-border)", verticalAlign: "middle" }}>
        <span style={{ fontSize: 12.5 }}>{created}</span>
      </td>
      <td style={{ padding: "12px 16px 12px 12px", borderBottom: "1px solid var(--color-border)", textAlign: "right", verticalAlign: "middle" }}>
        <Button size="sm">
          {isExpanded ? "收起" : "展开"} <Icon name={isExpanded ? "chevDown" : "chevRight"} size={11} />
        </Button>
      </td>
    </tr>
  );
}

function DatasetDetail({ ds }: { ds: DatasetResponse }) {
  const [itemPage, setItemPage] = useState(0);
  const { data: itemsData, isLoading: itemsLoading } = useDatasetItems(ds.id, { limit: 10, offset: itemPage * 10 });
  const { data: linkedProjects = [] } = useDatasetProjects(ds.id);
  const { data: allProjects } = useProjects();
  const unlinkMutation = useUnlinkProject(ds.id);
  const linkMutation = useLinkProject(ds.id);
  const scanMutation = useScanDatasetItems(ds.id);
  const pushToast = useToastStore((s) => s.push);

  const items = itemsData?.items ?? [];
  const totalItems = itemsData?.total ?? 0;
  const totalPages = Math.ceil(totalItems / 10);

  const linkedIds = new Set(linkedProjects.map((p) => p.id));
  const availableProjects = (allProjects ?? []).filter((p) => !linkedIds.has(p.id));

  return (
    <tr>
      <td colSpan={6} style={{ padding: 0, borderBottom: "1px solid var(--color-border)" }}>
        <div style={{ padding: "16px 20px", background: "var(--color-bg)" }}>
          <div style={{ display: "flex", gap: 16 }}>
            {/* 文件列表 */}
            <div style={{ flex: 2 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <h4 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>
                  文件列表 <span style={{ fontWeight: 400, color: "var(--color-fg-muted)" }}>({totalItems})</span>
                </h4>
                <div style={{ display: "flex", gap: 6 }}>
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
                  <Button size="sm" onClick={() => pushToast({ msg: "上传功能", sub: "请使用 API 或命令行上传文件到此数据集" })}>
                    <Icon name="upload" size={12} /> 上传
                  </Button>
                </div>
              </div>
              <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12.5 }}>
                <thead>
                  <tr>
                    {["文件名", "类型", "大小", "上传时间"].map((h, i) => (
                      <th key={i} style={{
                        textAlign: "left", fontWeight: 500, fontSize: 11,
                        color: "var(--color-fg-muted)", padding: "6px 8px",
                        borderBottom: "1px solid var(--color-border)",
                        background: "var(--color-bg-sunken)",
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {itemsLoading && (
                    <tr><td colSpan={4} style={{ textAlign: "center", padding: 20, color: "var(--color-fg-subtle)" }}>加载中...</td></tr>
                  )}
                  {!itemsLoading && items.map((item) => (
                    <tr key={item.id}>
                      <td style={{ padding: "8px", borderBottom: "1px solid var(--color-border)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <Icon name={item.file_type === "video" ? "video" : "image"} size={12} style={{ color: "var(--color-fg-muted)" }} />
                          <span style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.file_name}</span>
                        </div>
                      </td>
                      <td style={{ padding: "8px", borderBottom: "1px solid var(--color-border)" }}>
                        <Badge variant="outline">{item.file_type}</Badge>
                      </td>
                      <td style={{ padding: "8px", borderBottom: "1px solid var(--color-border)", color: "var(--color-fg-muted)" }}>
                        {item.file_size ? `${(item.file_size / 1024).toFixed(1)} KB` : "—"}
                      </td>
                      <td style={{ padding: "8px", borderBottom: "1px solid var(--color-border)", color: "var(--color-fg-muted)" }}>
                        {new Date(item.created_at).toLocaleDateString("zh-CN")}
                      </td>
                    </tr>
                  ))}
                  {!itemsLoading && items.length === 0 && (
                    <tr><td colSpan={4} style={{ textAlign: "center", padding: 20, color: "var(--color-fg-subtle)" }}>暂无文件</td></tr>
                  )}
                </tbody>
              </table>
              {totalPages > 1 && (
                <div style={{ display: "flex", gap: 4, justifyContent: "center", marginTop: 8 }}>
                  <Button size="sm" onClick={() => setItemPage(Math.max(0, itemPage - 1))} style={{ visibility: itemPage > 0 ? "visible" : "hidden" }}>
                    <Icon name="chevLeft" size={11} />
                  </Button>
                  <span style={{ fontSize: 11, color: "var(--color-fg-muted)", padding: "4px 8px" }}>
                    {itemPage + 1} / {totalPages}
                  </span>
                  <Button size="sm" onClick={() => setItemPage(Math.min(totalPages - 1, itemPage + 1))} style={{ visibility: itemPage < totalPages - 1 ? "visible" : "hidden" }}>
                    <Icon name="chevRight" size={11} />
                  </Button>
                </div>
              )}
            </div>

            {/* 关联项目 */}
            <div style={{ flex: 1, borderLeft: "1px solid var(--color-border)", paddingLeft: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <h4 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>
                  关联项目 <span style={{ fontWeight: 400, color: "var(--color-fg-muted)" }}>({linkedProjects.length})</span>
                </h4>
              </div>
              {linkedProjects.map((p) => (
                <div key={p.id} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "8px 0", borderBottom: "1px solid var(--color-border)",
                }}>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 500 }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>{p.display_id} · {p.type_label}</div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => unlinkMutation.mutate(p.id)}>
                    <Icon name="x" size={11} />
                  </Button>
                </div>
              ))}
              {linkedProjects.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--color-fg-subtle)", padding: "12px 0" }}>未关联任何项目</div>
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
                  style={{
                    marginTop: 8, width: "100%", padding: "6px 8px", fontSize: 12,
                    borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)",
                    background: "var(--color-bg-elev)", cursor: "pointer",
                  }}
                >
                  <option value="" disabled>关联到项目...</option>
                  {availableProjects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.display_id})</option>
                  ))}
                </select>
              )}
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}

function CreateDatasetForm({ onClose, onCreate }: { onClose: () => void; onCreate: (data: { name: string; description: string; data_type: string }) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [dataType, setDataType] = useState("image");

  return (
    <Card style={{ marginBottom: 16 }}>
      <div style={{ padding: 16 }}>
        <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600 }}>新建数据集</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: "var(--color-fg-muted)", display: "block", marginBottom: 4 }}>名称</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="输入数据集名称"
              style={{
                width: "100%", padding: "8px 10px", fontSize: 13,
                border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)",
                background: "var(--color-bg-elev)", boxSizing: "border-box",
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: "var(--color-fg-muted)", display: "block", marginBottom: 4 }}>描述</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="可选描述"
              rows={2}
              style={{
                width: "100%", padding: "8px 10px", fontSize: 13,
                border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)",
                background: "var(--color-bg-elev)", resize: "vertical", boxSizing: "border-box",
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: "var(--color-fg-muted)", display: "block", marginBottom: 4 }}>数据类型</label>
            <TabRow
              tabs={["图像", "视频", "3D 点云", "多模态"]}
              active={TYPE_LABELS[dataType] || "图像"}
              onChange={(v) => {
                const entry = Object.entries(TYPE_LABELS).find(([, label]) => label === v);
                if (entry) setDataType(entry[0]);
              }}
            />
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
            <Button onClick={onClose}>取消</Button>
            <Button variant="primary" onClick={() => name.trim() && onCreate({ name: name.trim(), description, data_type: dataType })}>
              <Icon name="plus" size={13} /> 创建
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

export function DatasetsPage() {
  const [filter, setFilter] = useState<string>("全部");
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  const { data: datasetsData, isLoading } = useDatasets({
    search: query || undefined,
    data_type: FILTER_MAP[filter],
  });
  const createMutation = useCreateDataset();

  const datasets = datasetsData?.items ?? [];
  const total = datasetsData?.total ?? 0;
  const totalFiles = datasets.reduce((sum, ds) => sum + ds.file_count, 0);
  const linkedCount = datasets.filter((ds) => ds.project_count > 0).length;

  const handleCreate = (data: { name: string; description: string; data_type: string }) => {
    createMutation.mutate(data, {
      onSuccess: (ds) => {
        pushToast({ msg: `数据集 "${ds.name}" 创建成功` });
        setShowCreate(false);
      },
    });
  };

  return (
    <div style={{ padding: "20px 28px 40px", maxWidth: 1480, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 4px", letterSpacing: "-0.01em" }}>数据集</h1>
          <p style={{ color: "var(--color-fg-muted)", fontSize: 13, margin: 0 }}>管理标注数据集，上传文件并关联到标注项目</p>
        </div>
        <Button variant="primary" onClick={() => setShowCreate(true)}>
          <Icon name="plus" size={13} /> 新建数据集
        </Button>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        <StatCard icon="layers" label="数据集总数" value={total.toLocaleString()} />
        <StatCard icon="image" label="文件总量" value={totalFiles.toLocaleString()} />
        <StatCard icon="folder" label="已关联项目" value={String(linkedCount)} />
        <StatCard icon="db" label="存储后端" value="MinIO" />
      </div>

      {/* Create form */}
      {showCreate && <CreateDatasetForm onClose={() => setShowCreate(false)} onCreate={handleCreate} />}

      {/* Main table */}
      <Card>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: "1px solid var(--color-border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>全部数据集</h3>
            <TabRow tabs={[...TYPE_FILTERS]} active={filter} onChange={setFilter} />
          </div>
          <SearchInput placeholder="搜索数据集..." value={query} onChange={setQuery} width={220} />
        </div>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 }}>
          <thead>
            <tr>
              {["数据集", "类型", "文件数", "关联项目", "创建时间", ""].map((h, i) => (
                <th key={i} style={{
                  textAlign: "left", fontWeight: 500, fontSize: 12,
                  color: "var(--color-fg-muted)", padding: "10px 12px",
                  borderBottom: "1px solid var(--color-border)",
                  background: "var(--color-bg-sunken)",
                  ...(i === 0 ? { paddingLeft: 16 } : {}),
                  ...(i === 5 ? { paddingRight: 16 } : {}),
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} style={{ textAlign: "center", padding: 40, color: "var(--color-fg-subtle)" }}>加载中...</td></tr>
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
              <tr><td colSpan={6} style={{ textAlign: "center", padding: 40, color: "var(--color-fg-subtle)" }}>
                {query || filter !== "全部" ? "没有匹配的数据集" : '暂无数据集，点击「新建数据集」开始'}
              </td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
