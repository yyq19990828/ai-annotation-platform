import { describe, expect, it } from "vitest";
import { resolveMaskPrimaryActions, type MaskPrimaryActionsInput } from "./maskPrimaryActions";
import type { MaskInstanceOperationPreview, MaskOperationPreview } from "./useMaskEditor";

function regionPreview(): MaskOperationPreview {
  return {
    id: 1,
    name: "lasso_add",
    sourceRevision: 8,
    alpha: new Uint8Array(4),
    report: {
      beforeArea: 2,
      afterArea: 4,
      changedPixels: 2,
      beforeComponents: 1,
      afterComponents: 1,
      beforeHoles: 0,
      afterHoles: 0,
      bounds: { x0: 0, y0: 0, x1: 2, y1: 2 },
    },
  };
}

function instancePreview(): MaskInstanceOperationPreview {
  return {
    id: 2,
    name: "split_components",
    sourceRevision: 8,
    plan: {
      kind: "split_components",
      sourceCount: 1,
      resultCount: 2,
      sourceAreas: [4],
      resultAreas: [3, 1],
      primary: new Uint8Array(4),
      created: [new Uint8Array(4)],
      focusAlpha: new Uint8Array(4),
    },
  };
}

function input(overrides: Partial<MaskPrimaryActionsInput> = {}): MaskPrimaryActionsInput {
  return {
    active: true,
    phase: "dirty",
    dirty: true,
    canEdit: true,
    canCommit: true,
    revision: 8,
    operationStatus: "idle",
    operationPreview: null,
    instanceOperationPreview: null,
    ...overrides,
  };
}

describe("resolveMaskPrimaryActions", () => {
  it("区域预览先应用到草稿，清除预览后的脏稿才允许保存", () => {
    const preview = resolveMaskPrimaryActions(
      input({ operationPreview: regionPreview(), operationStatus: "preview" }),
    );
    expect(preview.primary).toMatchObject({ kind: "apply_region", disabled: false });
    expect(preview.primary.description).toContain("随后保存才会写入标注");
    expect(preview.secondary).toMatchObject({ kind: "cancel_preview", disabled: false });

    const applied = resolveMaskPrimaryActions(input());
    expect(applied.primary).toMatchObject({ kind: "save", disabled: false });
    expect(applied.secondary.kind).toBe("exit");
  });

  it("即使像素未变，有效实例预览仍提交真实结果数", () => {
    const actions = resolveMaskPrimaryActions(
      input({
        dirty: false,
        phase: "ready",
        instanceOperationPreview: instancePreview(),
        operationStatus: "preview",
      }),
    );
    expect(actions.primary).toMatchObject({
      kind: "commit_instances",
      label: "提交 2 个实例",
      disabled: false,
    });
    expect(actions.primary.description).toContain("直接保存到当前任务");
    expect(actions.secondary.kind).toBe("cancel_preview");
  });

  it.each([{ revision: 9 }, { active: false }])(
    "区域预览脱离原始草稿后不回退到普通保存：%j",
    (stale) => {
      const actions = resolveMaskPrimaryActions(
        input({ operationPreview: regionPreview(), operationStatus: "preview", ...stale }),
      );
      expect(actions.primary.kind).toBe("recover_operation");
      expect(actions.secondary.kind).toBe("cancel_preview");
    },
  );

  it.each([true, false])("失效实例预览即使允许重试也只能刷新或取消：refresh=%s", (refresh) => {
    const actions = resolveMaskPrimaryActions(
      input({
        revision: 9,
        instanceOperationPreview: instancePreview(),
        operationStatus: "preview",
        instanceCanRetry: true,
        instanceCanRefresh: refresh,
      }),
    );
    expect(actions.primary.kind).toBe(refresh ? "refresh_instances" : "cancel_preview");
    expect(actions.secondary.kind).toBe("cancel_preview");
  });

  it("并存的区域与实例预览必须先恢复互斥状态", () => {
    const actions = resolveMaskPrimaryActions(
      input({
        operationPreview: regionPreview(),
        instanceOperationPreview: instancePreview(),
        operationStatus: "preview",
      }),
    );
    expect(actions.primary.kind).toBe("recover_operation");
    expect(actions.primary.description).toContain("冲突");
  });

  it("实例提交失败保留原预览并优先重试，不进入普通会话恢复或保存", () => {
    const actions = resolveMaskPrimaryActions(
      input({
        phase: "error",
        canEdit: false,
        canCommit: false,
        editBlockReason: "editor_error",
        instanceOperationPreview: instancePreview(),
        operationStatus: "preview",
        instanceCommitError: "服务暂不可用",
        instanceCanRetry: true,
        instanceCanRefresh: true,
      }),
    );
    expect(actions.primary).toMatchObject({ kind: "retry_instances", disabled: false });
    expect(actions.primary.description).toBe("服务暂不可用");
  });

  it.each([instancePreview(), null])("版本冲突恢复不要求可编辑或仍有旧预览：%j", (preview) => {
    const actions = resolveMaskPrimaryActions(
      input({
        phase: "error",
        canEdit: false,
        canCommit: false,
        editBlockReason: "editor_error",
        instanceOperationPreview: preview,
        instanceCommitError: "来源 Mask 已变更",
        instanceCanRetry: false,
        instanceCanRefresh: true,
        instanceCommitBlocked: true,
      }),
    );
    expect(actions.primary).toMatchObject({ kind: "refresh_instances", disabled: false });
    expect(actions.secondary.kind).toBe("cancel_preview");
  });

  it("实例未解决时即使残留可重试标记也不能提交", () => {
    const actions = resolveMaskPrimaryActions(
      input({
        instanceOperationPreview: instancePreview(),
        instanceCommitBlocked: true,
        instanceCanRetry: true,
      }),
    );
    expect(actions.primary.kind).toBe("cancel_preview");
  });

  it.each<Partial<MaskPrimaryActionsInput>>([
    { phase: "saving" },
    { savePending: true },
    { instanceCommitting: true },
    { instanceRefreshing: true },
    { interactionFrozen: true },
  ])("不可取消的处理阶段不会提交、恢复或清空预览：%j", (busy) => {
    const actions = resolveMaskPrimaryActions(
      input({
        instanceOperationPreview: instancePreview(),
        operationStatus: "preview",
        instanceCommitError: "此前的错误",
        instanceCanRetry: true,
        instanceCanRefresh: true,
        ...busy,
      }),
    );
    expect(actions.primary).toMatchObject({ kind: "none", disabled: true });
    expect(actions.secondary).toMatchObject({ kind: "none", disabled: true });
  });

  it("运算计算中不能保存已有脏稿，Esc 只取消运算", () => {
    const actions = resolveMaskPrimaryActions(input({ operationStatus: "computing" }));
    expect(actions.primary).toMatchObject({ kind: "none", disabled: true });
    expect(actions.secondary).toMatchObject({ kind: "cancel_preview", disabled: false });
    expect(actions.hint).toContain("保留已有像素草稿");
  });

  it("保存事务与运算状态同时存在时，不能通过 Esc 取消事务", () => {
    const actions = resolveMaskPrimaryActions(
      input({ operationStatus: "computing", savePending: true }),
    );
    expect(actions.secondary.disabled).toBe(true);
  });

  it("普通加载或保存失败只恢复会话，不宣称已经重试保存", () => {
    const actions = resolveMaskPrimaryActions(
      input({ phase: "error", canEdit: false, canCommit: false, active: false }),
    );
    expect(actions.primary).toMatchObject({ kind: "recover_session", label: "恢复编辑" });
    expect(actions.primary.description).toContain("再次保存");
  });

  it("错误会话中的有效区域预览须先恢复会话，仍保留取消预览路径", () => {
    const actions = resolveMaskPrimaryActions(
      input({ phase: "error", canEdit: false, operationPreview: regionPreview() }),
    );
    expect(actions.primary.kind).toBe("recover_session");
    expect(actions.secondary.kind).toBe("cancel_preview");
  });

  it.each([
    { operationStatus: "error" as const, operationError: new Error("预算不足") },
    { operationStatus: "preview" as const },
  ])("运算失败或缺失预览不能保存底层旧像素：%j", (operation) => {
    const actions = resolveMaskPrimaryActions(input(operation));
    expect(actions.primary.kind).toBe("recover_operation");
    expect(actions.secondary.kind).toBe("cancel_preview");
  });

  it("低内存禁止继续编辑时仍可保存像素草稿", () => {
    const actions = resolveMaskPrimaryActions(
      input({
        canEdit: false,
        canCommit: true,
        editBlockReason: "large_canvas_budget_exceeded",
      }),
    );
    expect(actions.primary).toMatchObject({ kind: "save", disabled: false });
  });

  it.each(["task_read_only", "annotation_locked", "track_locked", "segment_locked"] as const)(
    "写入锁不能被保存或实例重试标记绕过：%s",
    (editBlockReason) => {
      const state = input({ canEdit: false, canCommit: true, editBlockReason });
      expect(resolveMaskPrimaryActions(state).primary.disabled).toBe(true);
      const retry = resolveMaskPrimaryActions({
        ...state,
        phase: "error",
        instanceOperationPreview: instancePreview(),
        instanceCommitError: "提交失败",
        instanceCanRetry: true,
      });
      expect(retry.primary.kind).toBe("cancel_preview");
    },
  );

  it("像素不可编辑时不能应用区域预览或提交实例，即便普通保存仍被允许", () => {
    for (const preview of [
      { operationPreview: regionPreview() },
      { instanceOperationPreview: instancePreview() },
    ]) {
      const actions = resolveMaskPrimaryActions(
        input({ canEdit: false, canCommit: true, operationStatus: "preview", ...preview }),
      );
      expect(actions.primary.disabled).toBe(true);
      expect(actions.secondary.disabled).toBe(false);
    }
  });

  it("视频保持帧无修改时不产生动作，有修改才显示当前帧关键帧保存", () => {
    const state = input({
      dirty: false,
      phase: "ready",
      saveLabel: "保存当前帧关键帧",
      saveHint: "当前帧保持 F0 的 Mask，保存会创建 F1 人工关键帧。",
    });
    const clean = resolveMaskPrimaryActions(state);
    expect(clean.primary).toMatchObject({ kind: "none", label: "已保存", disabled: true });
    expect(clean.hint).toContain("Enter 不新建标注或关键帧");
    expect(clean.hint).toContain("F1 人工关键帧");

    const dirty = resolveMaskPrimaryActions({ ...state, dirty: true, phase: "dirty" });
    expect(dirty.primary).toMatchObject({
      kind: "save",
      label: "保存当前帧关键帧",
      disabled: false,
    });
    expect(dirty.primary.description).toContain("F1 人工关键帧");
  });

  it("未激活或加载中不能被描述为已保存", () => {
    const idle = resolveMaskPrimaryActions(input({ active: false, phase: "idle", dirty: false }));
    expect(idle.primary).toMatchObject({ kind: "none", label: "尚未编辑", disabled: true });
    expect(idle.secondary.kind).toBe("exit");
    const loading = resolveMaskPrimaryActions(input({ active: false, phase: "loading" }));
    expect(loading.primary).toMatchObject({ kind: "none", label: "加载中…", disabled: true });
    expect(loading.secondary.disabled).toBe(true);
  });
});
