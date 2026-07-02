import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";

import { INPUT_BBOX_PROMPT_ID, INPUT_CROP_ID, hasInput } from "@/api/capabilityInputs";
import {
  useCapabilityInstances,
  type CapabilityInstanceModel,
} from "@/api/mlCapabilities";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useToastStore } from "@/components/ui/Toast";
import { useCreateProjectPipeline } from "@/hooks/useProjectPipelines";
import type { PipelineStagePayload } from "@/hooks/usePreannotation";
import {
  ROOT_SID,
  classFilterText,
  producesGeometry,
  roiText,
  roleOf,
  stageWarning,
  variantText,
  type GraphNodeModel,
  type StageCaps,
} from "./utils/pipelineGraph";
import styles from "./GlobalPipelineLibraryPage.module.css";

const PipelineGraphCanvas = lazy(() => import("./components/PipelineGraphCanvas"));

interface GlobalModelOption {
  key: string;
  backendId: string;
  backendName: string;
  model: CapabilityInstanceModel;
  disabled: boolean;
}

function isGeometryModel(model: CapabilityInstanceModel | undefined): boolean {
  if (!model) return false;
  return (model.supported_geometric_outputs ?? []).length > 0;
}

function stageCapsFromGlobalModel(model: CapabilityInstanceModel | undefined): StageCaps | null {
  if (!model) return null;
  const supportedInputs = model.supported_inputs ?? [];
  const outputTypes = model.output_attribute_types ?? [];
  const rpBatchable = model.resource_profile?.batchable;
  return {
    hasCapabilities: true,
    knownInputs: supportedInputs.length > 0,
    acceptsCrop: hasInput(supportedInputs, INPUT_CROP_ID),
    acceptsBboxPrompt: hasInput(supportedInputs, INPUT_BBOX_PROMPT_ID),
    producesAttributes:
      outputTypes.length > 0 || (model.output_attribute_schema?.length ?? 0) > 0,
    producesClass: outputTypes.length > 0 ? outputTypes.includes("class") : undefined,
    batchable: typeof rpBatchable === "boolean" ? rpBatchable : undefined,
  };
}

function globalStagePayload(
  option: GlobalModelOption | null,
  stage: number,
  parentStage?: number,
): PipelineStagePayload | null {
  if (!option || option.disabled) return null;
  const geometry = isGeometryModel(option.model);
  const supportedInputs = option.model.supported_inputs ?? [];
  const inputMode = hasInput(supportedInputs, INPUT_BBOX_PROMPT_ID)
    ? "geometry"
    : "crop";
  return {
    stage,
    ml_backend_id: option.backendId,
    model_id: option.model.id,
    task_type: option.model.task,
    ...(parentStage == null
      ? {}
      : {
          parent_stage: parentStage,
          roi: { mode: "crop", pad: 0.05 },
          input: { mode: inputMode },
          write: { target: geometry ? "geometry" : "attributes" },
        }),
  };
}

export default function GlobalPipelineLibraryPage() {
  const pushToast = useToastStore((s) => s.push);
  const createProjectPipeline = useCreateProjectPipeline();
  const capabilityInstancesQ = useCapabilityInstances();
  const [pipelineName, setPipelineName] = useState("公共默认编排");
  const [globalSourceKey, setGlobalSourceKey] = useState("");
  const [globalDownstreamKey, setGlobalDownstreamKey] = useState("");
  const [globalDownstreamKeys, setGlobalDownstreamKeys] = useState<string[]>([]);
  const [selectedSid, setSelectedSid] = useState(ROOT_SID);

  const globalModelOptions = useMemo<GlobalModelOption[]>(() => {
    const out: GlobalModelOption[] = [];
    for (const inst of capabilityInstancesQ.data?.instances ?? []) {
      for (const model of inst.models ?? []) {
        out.push({
          key: `${inst.backend_id}::${model.id}`,
          backendId: inst.backend_id,
          backendName: inst.name,
          model,
          disabled: inst.state === "error",
        });
      }
    }
    return out;
  }, [capabilityInstancesQ.data]);

  const globalEnabledOptions = useMemo(
    () => globalModelOptions.filter((o) => !o.disabled),
    [globalModelOptions],
  );
  const optionByKey = useMemo(
    () => new Map(globalModelOptions.map((o) => [o.key, o])),
    [globalModelOptions],
  );

  useEffect(() => {
    if (!globalSourceKey || !optionByKey.has(globalSourceKey)) {
      setGlobalSourceKey(globalEnabledOptions[0]?.key ?? "");
    }
  }, [globalEnabledOptions, globalSourceKey, optionByKey]);

  useEffect(() => {
    if (!globalDownstreamKey || !optionByKey.has(globalDownstreamKey)) {
      setGlobalDownstreamKey(globalEnabledOptions[1]?.key ?? globalEnabledOptions[0]?.key ?? "");
    }
  }, [globalDownstreamKey, globalEnabledOptions, optionByKey]);

  const sourceOption = optionByKey.get(globalSourceKey) ?? null;
  const downstreamOptions = useMemo(
    () =>
      globalDownstreamKeys
        .map((key) => optionByKey.get(key))
        .filter((o): o is GlobalModelOption => !!o && !o.disabled),
    [globalDownstreamKeys, optionByKey],
  );

  const pipelineStages = useMemo(() => {
    const source = globalStagePayload(sourceOption, 0);
    if (!source) return null;
    const stages: PipelineStagePayload[] = [source];
    downstreamOptions.forEach((opt, index) => {
      const stage = globalStagePayload(opt, index + 1, 0);
      if (stage) stages.push(stage);
    });
    return stages;
  }, [downstreamOptions, sourceOption]);

  const graphNodes = useMemo<GraphNodeModel[]>(() => {
    const sourcePayload = pipelineStages?.[0] ?? null;
    const sourceCaps = stageCapsFromGlobalModel(sourceOption?.model);
    return [
      {
        sid: ROOT_SID,
        parentSid: null,
        kind: "source",
        role: roleOf(sourcePayload),
        detail: sourceOption?.model.display_name ?? "请选择源模型",
        runState: "pending",
        producesGeometry: true,
        canAddChild: false,
        conflict: false,
        backendName: sourceOption?.backendName,
        ready: !!sourcePayload,
        warning: sourceOption?.disabled
          ? "该 backend 探测失败，不能加入编排"
          : stageWarning(sourcePayload, sourceCaps),
        modelId: sourceOption?.model.id,
        taskType: sourceOption?.model.task,
      },
      ...downstreamOptions.map((opt, index) => {
        const stage = pipelineStages?.[index + 1] ?? null;
        const caps = stageCapsFromGlobalModel(opt.model);
        return {
          sid: `global-${index + 1}`,
          parentSid: ROOT_SID,
          kind: "stage" as const,
          role: roleOf(stage),
          detail: opt.model.display_name,
          runState: "pending" as const,
          producesGeometry: producesGeometry(stage),
          canAddChild: false,
          conflict: false,
          backendName: opt.backendName,
          ready: !!stage,
          warning: opt.disabled
            ? "该 backend 探测失败，不能加入编排"
            : stageWarning(stage, caps),
          classFilter: classFilterText(stage),
          modelId: opt.model.id,
          taskType: opt.model.task,
          roiInfo: roiText(stage),
          variantInfo: variantText(stage),
        };
      }),
    ];
  }, [downstreamOptions, pipelineStages, sourceOption]);

  const addDownstream = useCallback(() => {
    if (!globalDownstreamKey) return;
    const opt = optionByKey.get(globalDownstreamKey);
    if (!opt || opt.disabled) {
      pushToast({ msg: "该 backend 探测失败，不能加入编排", kind: "warning" });
      return;
    }
    setGlobalDownstreamKeys((keys) => [...keys, globalDownstreamKey]);
    setSelectedSid(`global-${globalDownstreamKeys.length + 1}`);
  }, [globalDownstreamKey, globalDownstreamKeys.length, optionByKey, pushToast]);

  const removeStage = useCallback((sid: string) => {
    if (!sid.startsWith("global-")) return;
    const idx = Number(sid.replace("global-", "")) - 1;
    if (!Number.isInteger(idx) || idx < 0) return;
    setGlobalDownstreamKeys((keys) => keys.filter((_, i) => i !== idx));
    setSelectedSid(ROOT_SID);
  }, []);

  const savePipeline = async () => {
    const name = pipelineName.trim();
    if (!name) {
      pushToast({ msg: "请输入编排名称", kind: "warning" });
      return;
    }
    if (!pipelineStages?.length) {
      pushToast({ msg: "请选择源模型", kind: "warning" });
      return;
    }
    try {
      await createProjectPipeline.mutateAsync({
        name,
        scope: "public",
        project_id: null,
        organization_id: null,
        stages: pipelineStages,
        is_default: false,
      });
      pushToast({
        msg: "已保存为公共编排",
        sub: `${pipelineStages.length} 阶段 · 可在项目预标注入口套用`,
        kind: "success",
      });
    } catch (e) {
      pushToast({
        msg: "保存公共编排失败",
        sub: (e as Error).message,
        kind: "warning",
      });
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.pageIntro}>
        <div>
          <h1 className={styles.pageTitle}>编排库</h1>
          <div className={styles.pageSubtitle}>
            从全局 backend/model 池创建可复用编排；项目页只负责套用到当前项目。
          </div>
        </div>
      </div>

      <Card>
        <div className={styles.toolbar}>
          <div className={styles.toolbarGroup}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>保存名称</span>
              <input
                className={styles.textInput}
                value={pipelineName}
                onChange={(e) => setPipelineName(e.target.value)}
                placeholder="例如 detect -> 车辆属性"
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>可见范围</span>
              <select className={styles.selectInput} value="public" disabled>
                <option value="public">公共</option>
              </select>
            </label>
          </div>
          <div className={styles.actions}>
            <Button
              size="sm"
              variant="primary"
              onClick={savePipeline}
              disabled={!pipelineStages || createProjectPipeline.isPending}
              title="把全局池构建的 DAG 保存为公共命名编排"
            >
              <Icon name="save" size={12} />
              保存公共编排
            </Button>
          </div>
        </div>

        <div className={styles.builder}>
          <div className={styles.pool}>
            <strong className={styles.sectionTitle}>全局 backend/model 池</strong>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>源阶段模型</span>
              <select
                className={styles.selectInput}
                value={globalSourceKey}
                onChange={(e) => setGlobalSourceKey(e.target.value)}
                disabled={capabilityInstancesQ.isLoading || globalModelOptions.length === 0}
                aria-label="全局源阶段模型"
              >
                {globalModelOptions.length === 0 ? (
                  <option value="">暂无全局模型</option>
                ) : (
                  globalModelOptions.map((opt) => (
                    <option key={opt.key} value={opt.key} disabled={opt.disabled}>
                      {opt.backendName} · {opt.model.display_name}
                      {opt.disabled ? " · 探测失败" : ""}
                    </option>
                  ))
                )}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>下游模型</span>
              <select
                className={styles.selectInput}
                value={globalDownstreamKey}
                onChange={(e) => setGlobalDownstreamKey(e.target.value)}
                disabled={capabilityInstancesQ.isLoading || globalModelOptions.length === 0}
                aria-label="全局下游模型"
              >
                {globalModelOptions.length === 0 ? (
                  <option value="">暂无全局模型</option>
                ) : (
                  globalModelOptions.map((opt) => (
                    <option key={opt.key} value={opt.key} disabled={opt.disabled}>
                      {opt.backendName} · {opt.model.display_name}
                      {opt.disabled ? " · 探测失败" : ""}
                    </option>
                  ))
                )}
              </select>
            </label>
            <div className={styles.actions}>
              <Button
                size="sm"
                variant="default"
                onClick={addDownstream}
                disabled={!globalDownstreamKey}
              >
                <Icon name="plus" size={12} />
                加入下游
              </Button>
            </div>
            <span className={styles.hint}>
              探测失败的 backend 会保留在池里但不可选择；套用到项目时仍会校验 backend 是否已启用。
            </span>
          </div>

          <div className={styles.canvas}>
            <Suspense fallback={<div className={styles.canvasFallback}>加载全局编排预览...</div>}>
              <PipelineGraphCanvas
                models={graphNodes}
                selectedSid={selectedSid}
                onSelect={setSelectedSid}
                onAddChild={() => undefined}
                onRemove={removeStage}
                onReparent={() => undefined}
                canReparentConn={() => false}
              />
            </Suspense>
          </div>
        </div>
      </Card>
    </div>
  );
}
