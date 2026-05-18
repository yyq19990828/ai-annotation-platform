// v0.10.15 · 外部预测导入向导.
//
// 三步: ①选格式 + 文件 + 兜底 model_version ② dry-run 预览 ③确认提交.
// 端点: POST /projects/{id}/predictions/import?format=&dry_run=
// 入库的 prediction 行 source='external_import', ml_backend_id=NULL.

import { useState, type DragEvent } from "react";
import { clsx } from "clsx";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToastStore } from "@/components/ui/Toast";
import {
  predictionsApi,
  type PredictionImportFormat,
  type PredictionImportResult,
} from "@/api/predictions";

import styles from "./PredictionImportWizard.module.css";

type WizardStep = "select" | "preview" | "done";

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: string;
  onComplete?: (result: PredictionImportResult) => void;
}

export function PredictionImportWizard({
  open,
  onClose,
  projectId,
  onComplete,
}: Props) {
  const pushToast = useToastStore((s) => s.push);

  const [step, setStep] = useState<WizardStep>("select");
  const [format, setFormat] = useState<PredictionImportFormat>("aap_json");
  const [file, setFile] = useState<File | null>(null);
  const [modelVersion, setModelVersion] = useState("");
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview] = useState<PredictionImportResult | null>(null);

  const reset = () => {
    setStep("select");
    setFormat("aap_json");
    setFile(null);
    setModelVersion("");
    setOverwriteExisting(false);
    setPreview(null);
  };

  const close = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const handleFile = (f: File | null) => {
    setFile(f);
    if (f && !f.name.toLowerCase().endsWith(".json")) {
      pushToast({ msg: "请选择 JSON 文件", kind: "warning" });
    }
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) handleFile(dropped);
  };

  const doDryRun = async () => {
    if (!file) {
      pushToast({ msg: "请先选择文件", kind: "warning" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await predictionsApi.import(
        projectId,
        format,
        file,
        {
          modelVersion: modelVersion || undefined,
          overwriteExisting,
        },
        true,
      );
      setPreview(res);
      setStep("preview");
    } catch (err) {
      pushToast({
        msg: err instanceof Error ? err.message : "解析失败",
        kind: "error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const doConfirm = async () => {
    if (!file) return;
    setSubmitting(true);
    try {
      const res = await predictionsApi.import(
        projectId,
        format,
        file,
        {
          modelVersion: modelVersion || undefined,
          overwriteExisting,
        },
        false,
      );
      setPreview(res);
      setStep("done");
      pushToast({
        msg: `导入完成: 写入 ${res.imported} 条, 跳过 ${res.skipped} 条`,
        kind: "success",
      });
      onComplete?.(res);
    } catch (err) {
      pushToast({
        msg: err instanceof Error ? err.message : "导入失败",
        kind: "error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={close} title="导入外部预测" width={560}>
      <div className={styles.wizard}>
        <StepBar step={step} />

        {step === "select" && (
          <>
            <div className={styles.formRow}>
              <label htmlFor="pi-format" className={styles.formLabel}>
                格式
              </label>
              <select
                id="pi-format"
                className={styles.input}
                value={format}
                onChange={(e) =>
                  setFormat(e.target.value as PredictionImportFormat)
                }
              >
                <option value="aap_json">AAP JSON (平台无损)</option>
                <option value="coco">COCO Detection</option>
              </select>
            </div>

            <div className={styles.formRow}>
              <label className={styles.formLabel}>文件</label>
              <label
                htmlFor="pi-file"
                className={clsx(
                  styles.fileDrop,
                  dragOver && styles.fileDropActive,
                )}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
              >
                {file ? (
                  <>
                    <div>已选文件</div>
                    <div className={styles.fileName}>{file.name}</div>
                  </>
                ) : (
                  <div>拖入 JSON 文件或点击选择</div>
                )}
                <input
                  id="pi-file"
                  type="file"
                  accept="application/json,.json"
                  hidden
                  onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>

            <div className={styles.formRow}>
              <label htmlFor="pi-mv" className={styles.formLabel}>
                兜底 model_version (可选)
              </label>
              <input
                id="pi-mv"
                className={styles.input}
                value={modelVersion}
                onChange={(e) => setModelVersion(e.target.value)}
                placeholder="例如 ext-yolov8-v1"
              />
            </div>

            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={overwriteExisting}
                onChange={(e) => setOverwriteExisting(e.target.checked)}
              />
              替换已有「外部导入」预测 (按 task 维度)
            </label>

            <div className={styles.actions}>
              <Button variant="ghost" onClick={close} disabled={submitting}>
                取消
              </Button>
              <Button
                variant="primary"
                onClick={doDryRun}
                disabled={!file || submitting}
              >
                {submitting ? "解析中..." : "预览"}
              </Button>
            </div>
          </>
        )}

        {step === "preview" && preview && (
          <>
            <PreviewBox preview={preview} />
            <div className={styles.actions}>
              <Button
                variant="ghost"
                onClick={() => setStep("select")}
                disabled={submitting}
              >
                返回修改
              </Button>
              <Button
                variant="primary"
                onClick={doConfirm}
                disabled={submitting || preview.imported === 0}
              >
                {submitting ? "导入中..." : `确认导入 ${preview.imported} 条`}
              </Button>
            </div>
          </>
        )}

        {step === "done" && preview && (
          <>
            <PreviewBox preview={preview} />
            <div className={styles.actions}>
              <Button variant="primary" onClick={close}>
                完成
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function StepBar({ step }: { step: WizardStep }) {
  const items: { key: WizardStep; label: string }[] = [
    { key: "select", label: "选择文件" },
    { key: "preview", label: "预览" },
    { key: "done", label: "完成" },
  ];
  const activeIdx = items.findIndex((it) => it.key === step);
  return (
    <div className={styles.stepBar}>
      {items.map((it, i) => (
        <span key={it.key}>
          <span
            className={clsx(
              styles.stepDot,
              i <= activeIdx && styles.stepDotActive,
            )}
          >
            {i + 1}
          </span>
          <span className={styles.stepLabel}>{it.label}</span>
          {i < items.length - 1 && <span className={styles.stepSeparator}>›</span>}
        </span>
      ))}
    </div>
  );
}

function PreviewBox({ preview }: { preview: PredictionImportResult }) {
  return (
    <div className={styles.previewBox}>
      <div className={styles.previewStats}>
        <div className={styles.previewStat}>
          <span className={styles.previewStatLabel}>将写入</span>
          <span className={styles.previewStatValue}>{preview.imported}</span>
        </div>
        <div className={styles.previewStat}>
          <span className={styles.previewStatLabel}>跳过</span>
          <span className={styles.previewStatValue}>{preview.skipped}</span>
        </div>
        <div className={styles.previewStat}>
          <span className={styles.previewStatLabel}>错误</span>
          <span className={styles.previewStatValue}>
            {preview.errors.length}
          </span>
        </div>
      </div>

      {preview.errors.length > 0 && (
        <div className={styles.errors}>
          {preview.errors.slice(0, 50).map((err, idx) => (
            <div key={idx} className={styles.errorRow}>
              <code>{JSON.stringify(err.task_match)}</code>{" "}
              <span className={styles.errorReason}>· {err.reason}</span>
            </div>
          ))}
          {preview.errors.length > 50 && (
            <div className={styles.errorRow}>
              ... 还有 {preview.errors.length - 50} 条错误未展示
            </div>
          )}
        </div>
      )}
    </div>
  );
}
