// v0.10.18 · CreateProjectWizard 第 5 步: 数据集关联 + 批次切分.
// 从 CreateProjectWizard.tsx 抽出.

import { useState } from "react";
import { clsx } from "clsx";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useToastStore } from "@/components/ui/Toast";
import { useDatasets } from "@/hooks/useDatasets";
import { useSplitBatches } from "@/hooks/useBatches";
import { LinkJobProgress } from "@/components/datasets/LinkJobProgress";
import type { DatasetResponse } from "@/api/datasets";
import type { ProjectResponse } from "@/api/projects";
import type { FormState } from "../CreateProjectWizard";
import styles from "../CreateProjectWizard.module.css";

export function Step5Datasets({
  project,
  form,
  setForm,
  onNext,
}: {
  project: ProjectResponse;
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  onNext: (linked: number) => void;
}) {
  const pushToast = useToastStore((s) => s.push);
  const { data: datasetsRes, isLoading } = useDatasets();
  const splitMutation = useSplitBatches(project.id);
  // useLinkProject 需要 datasetId 维度的实例，链路上每个 ds 的 mutation 都建一个会失控；
  // 这里走原始 api 直接调（hooks 仅用于 invalidate；step 完成后整体 invalidate 一次足够）。
  const datasets: DatasetResponse[] = datasetsRes?.items ?? [];
  const [linking, setLinking] = useState(false);
  // v0.12.0 · 大 dataset 异步建 task 的 job id 列表，非空则在底部显示进度条
  const [linkJobIds, setLinkJobIds] = useState<string[]>([]);

  const toggle = (id: string) => {
    setForm((s) => ({
      ...s,
      datasetIds: s.datasetIds.includes(id)
        ? s.datasetIds.filter((x) => x !== id)
        : [...s.datasetIds, id],
    }));
  };

  const onContinue = async () => {
    if (form.datasetIds.length === 0) {
      onNext(0);
      return;
    }
    setLinking(true);
    try {
      const { datasetsApi } = await import("@/api/datasets");
      // 依次 link（保证审计一行一项），失败不阻断
      let linkedOK = 0;
      const jobIds: string[] = [];
      for (const dsId of form.datasetIds) {
        try {
          const res = await datasetsApi.linkProject(dsId, project.id);
          if (res.async_job_id) jobIds.push(res.async_job_id);
          linkedOK++;
        } catch (e) {
          pushToast({
            msg: "数据集关联失败",
            sub: (e as Error).message,
            kind: "error",
          });
        }
      }
      // 切分（仅当用户选了 >=2）
      if (form.splitNBatches >= 2) {
        try {
          await splitMutation.mutateAsync({
            strategy: "random",
            n_batches: form.splitNBatches,
            name_prefix: "Batch",
            priority: 50,
          });
        } catch (e) {
          pushToast({
            msg: "批次切分失败（可在设置页重试）",
            sub: (e as Error).message,
          });
        }
      }
      pushToast({ msg: `已关联 ${linkedOK} 个数据集`, kind: "success" });
      // v0.12.0 · 有大 dataset 异步建 task：留在本步显示进度，待用户点「下一步」再前进；
      // 否则（全同步）直接前进。
      if (jobIds.length > 0) {
        setLinkJobIds(jobIds);
      } else {
        onNext(linkedOK);
      }
    } finally {
      setLinking(false);
    }
  };

  return (
    <div className={styles.formStack}>
      <div className={styles.sectionHint}>
        选择要关联到本项目的数据集（可空 / 多选）。关联后任务会作为「未归类」加入项目；选择下面的「随机切分」可以一并把任务切分到 N 个批次。
      </div>

      {isLoading && <div className={styles.inlineLoading}>加载数据集…</div>}

      {!isLoading && datasets.length === 0 && (
        <div className={styles.emptyPanel}>
          暂无可用数据集，可跳过此步骤稍后在「数据集」页关联。
        </div>
      )}

      {!isLoading && datasets.length > 0 && (
        <div className={styles.datasetList}>
          {datasets.map((d) => {
            const checked = form.datasetIds.includes(d.id);
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => toggle(d.id)}
                className={clsx(
                  styles.choiceButton,
                  checked && styles.choiceButtonChecked,
                )}
              >
                <span
                  className={clsx(
                    styles.checkMark,
                    checked && styles.checkMarkChecked,
                  )}
                >
                  {checked && <Icon name="check" size={10} />}
                </span>
                <span className={styles.choiceBody}>
                  <div className={styles.choiceTitle}>{d.name}</div>
                  <div className={styles.choiceMeta}>
                    <span className="mono">{d.display_id}</span> · {d.file_count}{" "}
                    个文件 · {d.data_type}
                  </div>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {form.datasetIds.length > 0 && (
        <div className={styles.splitPanel}>
          <div className={styles.splitTitle}>关联后的初始分包</div>
          <div className={styles.splitOptions}>
            <label className={styles.radioLabel}>
              <input
                type="radio"
                checked={form.splitNBatches === 0}
                onChange={() => setForm((s) => ({ ...s, splitNBatches: 0 }))}
              />
              保留默认包（每个数据集一个包）
            </label>
            <label className={styles.radioLabel}>
              <input
                type="radio"
                checked={form.splitNBatches >= 2}
                onChange={() =>
                  setForm((s) => ({
                    ...s,
                    splitNBatches: Math.max(2, s.splitNBatches),
                  }))
                }
              />
              随机切分为
              <input
                type="number"
                min={2}
                max={20}
                value={form.splitNBatches >= 2 ? form.splitNBatches : 3}
                disabled={form.splitNBatches < 2}
                onChange={(e) =>
                  setForm((s) => ({
                    ...s,
                    splitNBatches: Math.max(
                      2,
                      Math.min(20, Number(e.target.value)),
                    ),
                  }))
                }
                className={clsx(styles.input, styles.batchCountInput)}
              />
              个批次
            </label>
          </div>
        </div>
      )}

      {linkJobIds.length > 0 && (
        <div className={styles.linkProgressList}>
          {linkJobIds.map((jid) => (
            <LinkJobProgress
              key={jid}
              jobId={jid}
              projectId={project.id}
              onDone={() =>
                setLinkJobIds((prev) => prev.filter((x) => x !== jid))
              }
            />
          ))}
        </div>
      )}

      <div className={styles.stepActions}>
        {linkJobIds.length > 0 ? (
          <Button
            variant="primary"
            onClick={() => onNext(form.datasetIds.length)}
          >
            下一步
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={() => onNext(0)} disabled={linking}>
              跳过
            </Button>
            <Button variant="primary" onClick={onContinue} disabled={linking}>
              {linking
                ? "关联中…"
                : form.datasetIds.length === 0
                  ? "下一步"
                  : `关联 ${form.datasetIds.length} 个并继续`}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
