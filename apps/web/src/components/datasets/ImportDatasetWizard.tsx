import { useEffect, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useToastStore } from "@/components/ui/Toast";
import { useCreateDataset } from "@/hooks/useDatasets";
import { datasetsApi } from "@/api/datasets";
import { putWithProgress, runUploadQueue, type QueueItem } from "@/utils/uploadQueue";
import type { DatasetResponse } from "@/api/datasets";

type Step = 1 | 2 | 3;
type UploadMode = "files" | "zip";

const ZIP_MAX_BYTES = 200 * 1024 * 1024;

interface ZipResult {
  added: number;
  skipped: number;
  errors: Array<{ name: string; error: string }>;
  total_in_zip: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** 若给定，则跳过新建步骤，直接向已有数据集追加文件。 */
  datasetId?: string;
  datasetName?: string;
  onUploaded?: (datasetId: string, addedCount: number) => void;
}

const DATA_TYPES: Array<{ key: string; label: string }> = [
  { key: "image", label: "图像" },
  { key: "video", label: "视频" },
  { key: "point_cloud", label: "3D 点云" },
  { key: "multimodal", label: "多模态" },
  { key: "other", label: "其他" },
];

const STEP_LABELS: Record<Step, string> = {
  1: "基本信息",
  2: "选择文件",
  3: "上传完成",
};

export function ImportDatasetWizard({ open, onClose, datasetId, datasetName, onUploaded }: Props) {
  const navigate = useNavigate();
  const pushToast = useToastStore((s) => s.push);
  const createDataset = useCreateDataset();

  const skipCreate = !!datasetId;
  const [step, setStep] = useState<Step>(skipCreate ? 2 : 1);
  const [mode, setMode] = useState<UploadMode>("files");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [dataType, setDataType] = useState("image");
  const [files, setFiles] = useState<File[]>([]);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [zipProgress, setZipProgress] = useState(0);
  const [zipResult, setZipResult] = useState<ZipResult | null>(null);
  const [zipError, setZipError] = useState<string | null>(null);
  const [created, setCreated] = useState<DatasetResponse | null>(null);
  const [items, setItems] = useState<Map<string, QueueItem>>(new Map());
  const [running, setRunning] = useState(false);
  const tickRef = useRef(0);
  const [, force] = useState(0);

  useEffect(() => {
    if (!open) {
      // reset
      setStep(skipCreate ? 2 : 1);
      setMode("files");
      setName("");
      setDescription("");
      setDataType("image");
      setFiles([]);
      setZipFile(null);
      setZipProgress(0);
      setZipResult(null);
      setZipError(null);
      setCreated(null);
      setItems(new Map());
      setRunning(false);
      createDataset.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const trimmedName = name.trim();
  const nameValid = skipCreate || (trimmedName.length >= 2 && trimmedName.length <= 60);

  const targetDatasetId = datasetId || created?.id;

  const handleAddFiles = (incoming: FileList | File[]) => {
    const list = Array.from(incoming).filter((f) => f.size > 0);
    setFiles((prev) => {
      const seen = new Set(prev.map((file) => `${file.name}::${file.size}`));
      const merged = [...prev];
      for (const file of list) {
        const key = `${file.name}::${file.size}`;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(file);
        }
      }
      return merged;
    });
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer?.files?.length) handleAddFiles(e.dataTransfer.files);
  };

  const ensureDataset = async (): Promise<string | null> => {
    if (targetDatasetId) return targetDatasetId;
    try {
      const dsResp = await createDataset.mutateAsync({
        name: trimmedName,
        description: description.trim() || undefined,
        data_type: dataType,
      });
      setCreated(dsResp);
      return dsResp.id;
    } catch (err) {
      pushToast({
        msg: "创建数据集失败",
        sub: err instanceof Error ? err.message : String(err),
        kind: "error",
      });
      return null;
    }
  };

  const startFilesUpload = async () => {
    if (running || !files.length) return;
    const dsId = await ensureDataset();
    if (!dsId) return;

    const map = new Map<string, QueueItem>();
    files.forEach((_, i) => {
      map.set(`${i}`, {
        id: `${i}`,
        status: "pending",
        progress: 0,
      });
    });
    setItems(map);
    setStep(3);
    setRunning(true);

    const tasks = files.map((file, i) => ({
      id: `${i}`,
      worker: async (_signal: { aborted: boolean }, onProgress: (pct: number) => void) => {
        const init = await datasetsApi.uploadInit(dsId, {
          file_name: file.name,
          content_type: file.type || "application/octet-stream",
        });
        await putWithProgress(init.upload_url, file, onProgress);
        await datasetsApi.uploadComplete(dsId, init.item_id);
        return init.item_id;
      },
    }));

    await runUploadQueue(tasks, map, {
      concurrency: 3,
      onUpdate: () => {
        tickRef.current += 1;
        force((n) => n + 1);
      },
    });

    setRunning(false);
    const succeeded = Array.from(map.values()).filter((it) => it.status === "done").length;
    onUploaded?.(dsId, succeeded);
    pushToast({
      msg: `上传完成：成功 ${succeeded} / ${files.length}`,
      kind: succeeded === files.length ? "success" : succeeded === 0 ? "error" : "warning",
    });
  };

  const startZipUpload = async () => {
    if (running || !zipFile) return;
    const dsId = await ensureDataset();
    if (!dsId) return;

    setStep(3);
    setRunning(true);
    setZipProgress(0);
    setZipResult(null);
    setZipError(null);

    try {
      const res = await datasetsApi.uploadZip(dsId, zipFile, (pct) => setZipProgress(pct));
      setZipResult(res);
      onUploaded?.(dsId, res.added);
      pushToast({
        msg: `ZIP 解包完成：新增 ${res.added} 个文件`,
        sub: res.errors.length ? `${res.errors.length} 个失败` : undefined,
        kind: res.errors.length === 0 && res.added > 0 ? "success" : res.added === 0 ? "error" : "warning",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setZipError(msg);
      pushToast({ msg: "ZIP 上传失败", sub: msg, kind: "error" });
    } finally {
      setRunning(false);
    }
  };

  const goNextOrSubmit = () => {
    if (step === 1 && nameValid) setStep(2);
    else if (step === 2) {
      if (mode === "files") startFilesUpload();
      else startZipUpload();
    }
  };

  const titleSuffix = datasetName ? ` · ${datasetName}` : "";

  const stepNums: Step[] = skipCreate ? [2, 3] : [1, 2, 3];

  return (
    <Modal open={open} onClose={onClose} title={`导入数据集${titleSuffix}`} width={640}>
      <Stepper current={step} steps={stepNums} />

      {step === 1 && !skipCreate && (
        <Step1
          name={name}
          description={description}
          dataType={dataType}
          setName={setName}
          setDescription={setDescription}
          setDataType={setDataType}
          nameValid={nameValid}
        />
      )}

      {step === 2 && (
        <Step2
          mode={mode}
          setMode={(m) => {
            setMode(m);
            // 切换模式时清掉对侧选择
            if (m === "files") setZipFile(null);
            else setFiles([]);
          }}
          files={files}
          zipFile={zipFile}
          onAddFiles={handleAddFiles}
          onSetZip={(f) => setZipFile(f)}
          onDrop={handleDrop}
          onRemove={(idx) => setFiles((arr) => arr.filter((_, i) => i !== idx))}
        />
      )}

      {step === 3 && (
        mode === "files" ? (
          <Step3
            files={files}
            items={items}
            running={running}
            onClose={onClose}
            onView={() => {
              const id = targetDatasetId;
              onClose();
              if (id) navigate(`/datasets`);
            }}
          />
        ) : (
          <Step3Zip
            zipFile={zipFile!}
            progress={zipProgress}
            running={running}
            result={zipResult}
            error={zipError}
            onClose={onClose}
            onView={() => {
              const id = targetDatasetId;
              onClose();
              if (id) navigate(`/datasets`);
            }}
          />
        )
      )}

      {step !== 3 && (
        <Footer
          step={step}
          mode={mode}
          skipCreate={skipCreate}
          canNext={
            (step === 1 && nameValid) ||
            (step === 2 && (mode === "files" ? files.length > 0 : !!zipFile))
          }
          loading={createDataset.isPending}
          onCancel={onClose}
          onPrev={() => {
            if (skipCreate) return;
            setStep((s) => (s > 1 ? ((s - 1) as Step) : s));
          }}
          onNext={goNextOrSubmit}
        />
      )}
    </Modal>
  );
}

// ── Stepper ──────────────────────────────────────────────────────────────────

function Stepper({ current, steps }: { current: Step; steps: Step[] }) {
  return (
    <div style={{ display: "flex", alignItems: "center", marginBottom: 20 }}>
      {steps.map((n, i) => {
        const active = n === current;
        const done = n < current;
        const color = done || active ? "var(--color-accent)" : "var(--color-fg-subtle)";
        const last = i === steps.length - 1;
        return (
          <div key={n} style={{ display: "flex", alignItems: "center", flex: !last ? 1 : "0 0 auto" }}>
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: "50%",
                background: done || active ? "var(--color-accent)" : "var(--color-bg-sunken)",
                color: done || active ? "#fff" : "var(--color-fg-muted)",
                fontSize: 12,
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                border: active ? "2px solid var(--color-accent-soft)" : "1px solid var(--color-border)",
                flexShrink: 0,
              }}
            >
              {done ? <Icon name="check" size={12} /> : n}
            </div>
            <span style={{ marginLeft: 8, fontSize: 12, color, fontWeight: active ? 600 : 500 }}>
              {STEP_LABELS[n]}
            </span>
            {!last && (
              <div
                style={{
                  flex: 1,
                  height: 1,
                  margin: "0 12px",
                  background: n < current ? "var(--color-accent)" : "var(--color-border)",
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

const labelStyle: CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 500,
  color: "var(--color-fg-muted)",
  marginBottom: 6,
};

const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 11px",
  fontSize: 13.5,
  background: "var(--color-bg-sunken)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-md)",
  color: "var(--color-fg)",
  outline: "none",
  fontFamily: "inherit",
};

// ── Step 1 ───────────────────────────────────────────────────────────────────

function Step1({
  name,
  description,
  dataType,
  setName,
  setDescription,
  setDataType,
  nameValid,
}: {
  name: string;
  description: string;
  dataType: string;
  setName: (v: string) => void;
  setDescription: (v: string) => void;
  setDataType: (v: string) => void;
  nameValid: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <label style={labelStyle}>数据集名称</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="如：商品检测训练集 v1"
          maxLength={60}
          style={{ ...inputStyle, borderColor: nameValid ? "var(--color-border)" : "var(--color-danger)" }}
        />
      </div>
      <div>
        <label style={labelStyle}>描述（可选）</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="简要说明数据来源、采集场景等"
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </div>
      <div>
        <label style={labelStyle}>数据类型</label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {DATA_TYPES.map((t) => {
            const active = dataType === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setDataType(t.key)}
                style={{
                  padding: "6px 12px",
                  fontSize: 12.5,
                  borderRadius: "var(--radius-md)",
                  border: `1px solid ${active ? "var(--color-accent)" : "var(--color-border)"}`,
                  background: active ? "var(--color-accent-soft)" : "var(--color-bg-elev)",
                  color: active ? "var(--color-accent)" : "var(--color-fg)",
                  cursor: "pointer",
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Step 2 ───────────────────────────────────────────────────────────────────

function Step2({
  mode,
  setMode,
  files,
  zipFile,
  onAddFiles,
  onSetZip,
  onDrop,
  onRemove,
}: {
  mode: UploadMode;
  setMode: (m: UploadMode) => void;
  files: File[];
  zipFile: File | null;
  onAddFiles: (files: FileList | File[]) => void;
  onSetZip: (f: File | null) => void;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
  onRemove: (idx: number) => void;
}) {
  const filesInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const [hover, setHover] = useState(false);
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  const handleZipPick = (f: File | null) => {
    if (!f) return;
    if (!/\.zip$/i.test(f.name)) {
      alert("请选择 .zip 文件");
      return;
    }
    if (f.size > ZIP_MAX_BYTES) {
      alert(`ZIP 包不能超过 ${ZIP_MAX_BYTES / 1024 / 1024}MB`);
      return;
    }
    onSetZip(f);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* mode toggle */}
      <div style={{ display: "flex", gap: 6 }}>
        {([
          { key: "files", label: "多文件" },
          { key: "zip", label: "ZIP 包 (≤200MB)" },
        ] as const).map((opt) => {
          const active = mode === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => setMode(opt.key)}
              style={{
                padding: "6px 14px",
                fontSize: 12.5,
                borderRadius: "var(--radius-md)",
                border: `1px solid ${active ? "var(--color-accent)" : "var(--color-border)"}`,
                background: active ? "var(--color-accent-soft)" : "var(--color-bg-elev)",
                color: active ? "var(--color-accent)" : "var(--color-fg)",
                cursor: "pointer",
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {mode === "files" && (
        <>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setHover(true);
            }}
            onDragLeave={() => setHover(false)}
            onDrop={(e) => {
              setHover(false);
              onDrop(e);
            }}
            onClick={() => filesInputRef.current?.click()}
            style={{
              padding: "28px 16px",
              textAlign: "center",
              border: `2px dashed ${hover ? "var(--color-accent)" : "var(--color-border)"}`,
              borderRadius: "var(--radius-md)",
              background: hover ? "var(--color-accent-soft)" : "var(--color-bg-sunken)",
              cursor: "pointer",
              transition: "background 0.15s, border-color 0.15s",
            }}
          >
            <Icon name="upload" size={22} style={{ color: "var(--color-fg-muted)", marginBottom: 8 }} />
            <div style={{ fontSize: 13.5, color: "var(--color-fg)", marginBottom: 4 }}>
              拖拽文件到此处，或<span style={{ color: "var(--color-accent)" }}> 点击选择</span>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--color-fg-muted)" }}>支持图像 / 视频 / 任意二进制；单文件 ≤ 5GB</div>
            <input
              ref={filesInputRef}
              type="file"
              multiple
              style={{ display: "none" }}
              onChange={(e) => {
                if (e.target.files) onAddFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          {files.length > 0 && (
            <div
              style={{
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-md)",
                background: "var(--color-bg-elev)",
                maxHeight: 240,
                overflow: "auto",
              }}
            >
              <div
                style={{
                  padding: "8px 12px",
                  borderBottom: "1px solid var(--color-border)",
                  fontSize: 12,
                  color: "var(--color-fg-muted)",
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span>已选 {files.length} 个文件</span>
                <span>{formatBytes(totalSize)}</span>
              </div>
              {files.map((f, i) => (
                <div
                  key={`${f.name}-${i}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 12px",
                    borderBottom: i < files.length - 1 ? "1px solid var(--color-border)" : undefined,
                    fontSize: 12.5,
                  }}
                >
                  <Icon name={iconForFile(f)} size={12} style={{ color: "var(--color-fg-muted)" }} />
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                  <span style={{ color: "var(--color-fg-muted)", fontSize: 11 }}>{formatBytes(f.size)}</span>
                  <button
                    type="button"
                    onClick={() => onRemove(i)}
                    aria-label="移除"
                    style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--color-fg-muted)" }}
                  >
                    <Icon name="x" size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {mode === "zip" && (
        <>
          <div
            onClick={() => zipInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setHover(true);
            }}
            onDragLeave={() => setHover(false)}
            onDrop={(e) => {
              e.preventDefault();
              setHover(false);
              const f = e.dataTransfer?.files?.[0];
              handleZipPick(f ?? null);
            }}
            style={{
              padding: "28px 16px",
              textAlign: "center",
              border: `2px dashed ${hover ? "var(--color-accent)" : "var(--color-border)"}`,
              borderRadius: "var(--radius-md)",
              background: hover ? "var(--color-accent-soft)" : "var(--color-bg-sunken)",
              cursor: "pointer",
            }}
          >
            <Icon name="upload" size={22} style={{ color: "var(--color-fg-muted)", marginBottom: 8 }} />
            <div style={{ fontSize: 13.5, color: "var(--color-fg)", marginBottom: 4 }}>
              拖入或<span style={{ color: "var(--color-accent)" }}> 点击选择</span> ZIP 包
            </div>
            <div style={{ fontSize: 11.5, color: "var(--color-fg-muted)" }}>
              整包 ≤ 200MB；包内文件数 ≤ 5000；自动跳过 __MACOSX/ 与隐藏文件
            </div>
            <input
              ref={zipInputRef}
              type="file"
              accept=".zip,application/zip"
              style={{ display: "none" }}
              onChange={(e) => {
                handleZipPick(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
          </div>

          {zipFile && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-md)",
                background: "var(--color-bg-elev)",
                fontSize: 13,
              }}
            >
              <Icon name="folder" size={14} style={{ color: "var(--color-fg-muted)" }} />
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{zipFile.name}</span>
              <span style={{ color: "var(--color-fg-muted)", fontSize: 12 }}>{formatBytes(zipFile.size)}</span>
              <button
                type="button"
                onClick={() => onSetZip(null)}
                aria-label="移除"
                style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--color-fg-muted)" }}
              >
                <Icon name="x" size={12} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Step 3 ───────────────────────────────────────────────────────────────────

function Step3({
  files,
  items,
  running,
  onClose,
  onView,
}: {
  files: File[];
  items: Map<string, QueueItem>;
  running: boolean;
  onClose: () => void;
  onView: () => void;
}) {
  const arr = files.map((f, i) => ({ file: f, item: items.get(`${i}`) }));
  const done = arr.filter((x) => x.item?.status === "done").length;
  const failed = arr.filter((x) => x.item?.status === "error").length;
  const overall = arr.length === 0 ? 0 : Math.round(arr.reduce((s, x) => s + (x.item?.progress ?? 0), 0) / arr.length);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          padding: "10px 12px",
          background: "var(--color-bg-sunken)",
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--color-border)",
          display: "flex",
          justifyContent: "space-between",
          fontSize: 12.5,
        }}
      >
        <span>
          总进度 <strong>{overall}%</strong> · 成功 {done} / 失败 {failed} / 共 {arr.length}
        </span>
        <span style={{ color: running ? "var(--color-accent)" : "var(--color-fg-muted)" }}>
          {running ? "上传中…" : "已完成"}
        </span>
      </div>

      <div
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-md)",
          background: "var(--color-bg-elev)",
          maxHeight: 280,
          overflow: "auto",
        }}
      >
        {arr.map(({ file, item }, i) => (
          <div
            key={i}
            style={{
              padding: "8px 12px",
              borderBottom: i < arr.length - 1 ? "1px solid var(--color-border)" : undefined,
              fontSize: 12.5,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon
                name={item?.status === "done" ? "check" : item?.status === "error" ? "warning" : iconForFile(file)}
                size={12}
                style={{
                  color:
                    item?.status === "done"
                      ? "var(--color-success)"
                      : item?.status === "error"
                        ? "var(--color-danger)"
                        : "var(--color-fg-muted)",
                }}
              />
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</span>
              <span style={{ color: "var(--color-fg-muted)", fontSize: 11 }}>
                {item?.status === "error" ? "失败" : `${Math.round(item?.progress ?? 0)}%`}
              </span>
            </div>
            <div
              style={{
                marginTop: 4,
                height: 3,
                background: "var(--color-bg-sunken)",
                borderRadius: 2,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${item?.progress ?? 0}%`,
                  height: "100%",
                  background:
                    item?.status === "error"
                      ? "var(--color-danger)"
                      : item?.status === "done"
                        ? "var(--color-success)"
                        : "var(--color-accent)",
                  transition: "width 0.2s",
                }}
              />
            </div>
            {item?.error && (
              <div style={{ marginTop: 3, fontSize: 11, color: "var(--color-danger)" }}>{item.error}</div>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Button onClick={onClose}>关闭</Button>
        <Button variant="primary" onClick={onView} disabled={running}>
          查看数据集
        </Button>
      </div>
    </div>
  );
}

// ── Footer ───────────────────────────────────────────────────────────────────

function Footer({
  step,
  mode,
  skipCreate,
  canNext,
  loading,
  onCancel,
  onPrev,
  onNext,
}: {
  step: Step;
  mode: UploadMode;
  skipCreate: boolean;
  canNext: boolean;
  loading: boolean;
  onCancel: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const showPrev = !skipCreate && step > 1;
  const submitLabel = mode === "zip" ? "上传 ZIP" : "开始上传";
  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 18 }}>
      <div>
        {showPrev && (
          <Button onClick={onPrev}>
            <Icon name="chevLeft" size={12} /> 上一步
          </Button>
        )}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <Button onClick={onCancel}>取消</Button>
        <Button variant="primary" onClick={onNext} disabled={!canNext || loading}>
          {step === 2 ? (loading ? "处理中…" : submitLabel) : "下一步"}
          {step !== 2 && <Icon name="chevRight" size={12} />}
        </Button>
      </div>
    </div>
  );
}

// ── Step 3 (ZIP) ─────────────────────────────────────────────────────────────

function Step3Zip({
  zipFile,
  progress,
  running,
  result,
  error,
  onClose,
  onView,
}: {
  zipFile: File;
  progress: number;
  running: boolean;
  result: ZipResult | null;
  error: string | null;
  onClose: () => void;
  onView: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          padding: "10px 12px",
          background: "var(--color-bg-sunken)",
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--color-border)",
          fontSize: 12.5,
          display: "flex",
          gap: 10,
          alignItems: "center",
        }}
      >
        <Icon name="folder" size={14} style={{ color: "var(--color-fg-muted)" }} />
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {zipFile.name}
        </span>
        <span style={{ color: "var(--color-fg-muted)", fontSize: 12 }}>{formatBytes(zipFile.size)}</span>
      </div>

      <div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--color-fg-muted)", marginBottom: 4 }}>
          <span>{running ? "上传中…（服务端解压通常在 0% 跳到 100% 后等待几秒）" : result ? "解包完成" : error ? "失败" : "等待"}</span>
          <span>{Math.round(progress)}%</span>
        </div>
        <div
          style={{
            height: 6,
            background: "var(--color-bg-sunken)",
            borderRadius: 3,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${progress}%`,
              height: "100%",
              background: error
                ? "var(--color-danger)"
                : result
                  ? "var(--color-success)"
                  : "var(--color-accent)",
              transition: "width 0.2s",
            }}
          />
        </div>
      </div>

      {result && (
        <div
          style={{
            padding: "10px 12px",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
            background: "var(--color-bg-elev)",
            fontSize: 13,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <div>
            <strong style={{ color: "var(--color-success)" }}>新增 {result.added}</strong> 个文件 ·{" "}
            <span style={{ color: "var(--color-fg-muted)" }}>
              ZIP 内共 {result.total_in_zip} · 跳过 {result.skipped} · 失败 {result.errors.length}
            </span>
          </div>
          {result.errors.length > 0 && (
            <details style={{ marginTop: 4 }}>
              <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--color-fg-muted)" }}>
                查看 {result.errors.length} 条失败明细
              </summary>
              <div style={{ marginTop: 6, maxHeight: 160, overflow: "auto", fontSize: 11.5 }}>
                {result.errors.slice(0, 50).map((e, i) => (
                  <div key={i} style={{ padding: "3px 0", color: "var(--color-danger)" }}>
                    <span className="mono">{e.name}</span> — {e.error}
                  </div>
                ))}
                {result.errors.length > 50 && (
                  <div style={{ padding: "3px 0", color: "var(--color-fg-muted)" }}>
                    …其余 {result.errors.length - 50} 条已省略
                  </div>
                )}
              </div>
            </details>
          )}
        </div>
      )}

      {error && (
        <div
          style={{
            padding: "10px 12px",
            background: "rgba(239,68,68,0.08)",
            border: "1px solid #ef4444",
            borderRadius: "var(--radius-md)",
            color: "#ef4444",
            fontSize: 12.5,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Button onClick={onClose}>关闭</Button>
        <Button variant="primary" onClick={onView} disabled={running}>
          查看数据集
        </Button>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function iconForFile(f: File) {
  if (f.type.startsWith("image/")) return "image" as const;
  if (f.type.startsWith("video/")) return "video" as const;
  return "layers" as const;
}
