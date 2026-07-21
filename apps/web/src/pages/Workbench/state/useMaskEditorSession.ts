// v0.23.5 · WS-B · 图片 / 视频统一的 mask 编辑会话状态机。
//
// 在 useMaskEditor (buffer + undo/redo + 模式) 之上叠加 ADR-0052 D7 冻结的会话语义:
//
//   idle → loading → ready → dirty → saving → error
//
// - sessionId = hash(taskId, frameIndex, selectionKey, annotationVersion) + 单调 generation;
//   过期请求 (旧 GET / 404 / mutation 回包 generation 不匹配) 不得回写 Buffer。
// - loading / saving 禁止 pointer 写入 (canEditMask 据此判定)。
// - 保存走单飞 Promise: 重复 Enter / 双击只触发一次 mutation; 成功才清 Buffer,
//   失败保留 history / label / refine lineage, 暴露 retry。
// - 离开 dirty session (切 task / frame / tool / route) 触发 guard 回调, 由调用方
//   决定保存 / 丢弃 / 继续编辑。
//
// 设计取舍: 不破坏 useMaskEditor 现有签名 (被图片 / 视频共用, 大量调用点), 而是在外层
// 包一层 session; 调用方按需迁移到 session API。本版先让视频侧 (迟到 GET 覆盖主战场)
// 接入 session 的 generation 隔离与单飞保存; 图片侧逐步跟进。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMaskEditor, type UseMaskEditorOptions, type UseMaskEditorReturn } from "./useMaskEditor";
import type { CocoRle } from "../stage/shared/geometry/maskRle";
import type { MaskEditorPhase } from "./canEditMask";

/** 会话键输入: 标识一段唯一的编辑上下文。 */
export interface MaskSessionKey {
  taskId: string | undefined;
  frameIndex: number;
  /** 选中对象标识 (annotation id 或 "blank"); 不同对象互不干扰。 */
  selectionKey: string;
  /** annotation version (服务端乐观锁), 刷新后变化 → 新 session。 */
  annotationVersion: number | undefined;
}

export type MaskSessionGuardChoice = "save" | "discard" | "continue";

export interface UseMaskEditorSessionOptions extends UseMaskEditorOptions {
  /** 当前会话键; 变化 → 开新 session (自增 generation)。 */
  sessionKey: MaskSessionKey;
  /**
   * 离开 dirty session 时的 guard。返回 Promise<choice>; 调用方据此 save/discard/continue。
   * 未提供时默认 "discard" (保持旧行为, 但暴露 dirty 让调用方在迁移期自行接管)。
   */
  onLeaveDirty?: (key: MaskSessionKey) => Promise<MaskSessionGuardChoice>;
}

export interface MaskSaveResult {
  ok: boolean;
  /** 409 / 网络错误等可重试错误; 调用方决定是否暴露 retry。 */
  retryable: boolean;
  error?: unknown;
}

export interface UseMaskEditorSessionReturn extends UseMaskEditorReturn {
  /** 当前会话相位。 */
  phase: MaskEditorPhase;
  /** 稳定会话 id (key 的序列化)。 */
  sessionId: string;
  /** 单调递增代次; 每次 sessionKey 变化自增。 */
  generation: number;
  /** 上一次保存的错误 (error 相位时非空)。 */
  lastSaveError: unknown;
  /** 是否有进行中的保存 (单飞)。 */
  saveInFlight: boolean;
  /**
   * 按 generation 隔离的 RLE 加载: 仅当 generation 仍匹配当前 session 才 initFromRle。
   * 迟到 GET / 404 回包对旧 generation 调用 → 静默丢弃, 不覆盖 Buffer (A1)。
   */
  loadRle: (gen: number, rle: CocoRle) => void;
  /** 按 generation 隔离的 blank 加载 (404 → beginBlank 场景)。 */
  loadBlank: (gen: number) => void;
  /**
   * 单飞保存: 同一 session 内重复调用合并为一次 Promise。
   * 成功 → phase=ready (或 idle, 由调用方 cancel); 失败 → phase=error, 保留 Buffer, 可 retry。
   */
  save: (commit: () => Promise<MaskSaveResult>) => Promise<MaskSaveResult>;
  /** 从 error 恢复到 dirty (用户继续编辑)。 */
  recoverFromError: () => void;
}

function serializeKey(key: MaskSessionKey): string {
  return `${key.taskId ?? "?"}|f${key.frameIndex}|s${key.selectionKey}|v${key.annotationVersion ?? "?"}`;
}

/**
 * mask 编辑会话状态机 hook。包裹 useMaskEditor, 在其上叠加 phase / generation / 单飞保存。
 */
export function useMaskEditorSession({
  sessionKey,
  onLeaveDirty,
  ...editorOpts
}: UseMaskEditorSessionOptions): UseMaskEditorSessionReturn {
  const editor = useMaskEditor(editorOpts);
  const [phase, setPhase] = useState<MaskEditorPhase>("idle");
  const [generation, setGeneration] = useState(0);
  const [lastSaveError, setLastSaveError] = useState<unknown>(undefined);
  const [saveInFlight, setSaveInFlight] = useState(false);

  const sessionId = useMemo(() => serializeKey(sessionKey), [sessionKey]);
  const generationRef = useRef(0);
  const savePromiseRef = useRef<Promise<MaskSaveResult> | null>(null);
  // 最近一次 sessionKey 序列化值, 用于检测变化并自增 generation。
  const lastKeyRef = useRef<string | null>(null);
  // refs 让 sessionKey-change effect 只依赖 sessionId, 避免每次 render 重跑。
  const phaseRef = useRef<MaskEditorPhase>(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  const onLeaveDirtyRef = useRef(onLeaveDirty);
  useEffect(() => { onLeaveDirtyRef.current = onLeaveDirty; }, [onLeaveDirty]);
  const editorActiveRef = useRef(editor.active);
  useEffect(() => { editorActiveRef.current = editor.active; }, [editor.active]);
  const sessionKeyRef = useRef(sessionKey);
  useEffect(() => { sessionKeyRef.current = sessionKey; }, [sessionKey]);

  // sessionKey 变化 → 自增 generation, 进入 loading (调用方随后 loadRle/loadBlank)。
  // 若旧 session 处于 dirty/saving/error, 触发 onLeaveDirty guard。
  useEffect(() => {
    const serialized = sessionId;
    if (lastKeyRef.current === serialized) return;
    const previousPhase = phaseRef.current;
    const wasDirty = previousPhase === "dirty" || previousPhase === "error";
    lastKeyRef.current = serialized;
    generationRef.current += 1;
    setGeneration(generationRef.current);

    if (wasDirty && editorActiveRef.current && onLeaveDirtyRef.current) {
      // 异步 guard: 不阻塞 generation 推进 (新 session 立即可加载), 但通知调用方处理旧稿件。
      // 默认 continue (保留旧 buffer 让用户回来处理) —— 调用方可覆写为 save/discard。
      void onLeaveDirtyRef.current(sessionKeyRef.current).catch(
        () => "continue" as MaskSessionGuardChoice,
      );
    }
    // 新 session: 重置保存错误, 进入 loading (等待 loadRle/loadBlank)。
    setLastSaveError(undefined);
    setSaveInFlight(false);
    savePromiseRef.current = null;
    setPhase("loading");
    // 注意: 不在这里 cancel editor.buffer —— loadRle/loadBlank 会覆盖; 若调用方不加载,
    // editor 保留旧 buffer 但 phase=loading 使 canEditMask 拒绝写入, 直到 ready。
  }, [sessionId]);

  const loadRle = useCallback((gen: number, rle: CocoRle) => {
    if (gen !== generationRef.current) return; // 迟到回包, 丢弃
    editor.initFromRle(rle);
    setPhase("ready");
  }, [editor]);

  const loadBlank = useCallback((gen: number) => {
    if (gen !== generationRef.current) return;
    editor.beginBlank();
    setPhase("ready");
  }, [editor]);

  // editor 内部 dirty 变化 → 同步 phase (ready ↔ dirty)。
  useEffect(() => {
    setPhase((cur) => {
      if (cur === "loading" || cur === "saving" || cur === "error") return cur;
      return editor.dirty ? "dirty" : "ready";
    });
  }, [editor.dirty]);

  const save = useCallback((commit: () => Promise<MaskSaveResult>): Promise<MaskSaveResult> => {
    // 单飞: 同 session 内重复 Enter / 双击合并为同一 Promise。
    if (savePromiseRef.current) return savePromiseRef.current;
    setPhase("saving");
    setSaveInFlight(true);
    const gen = generationRef.current;
    const promise = commit().then((result) => {
      // 迟到回包 (session 已切换): 不改当前 phase, 只清自己的引用。
      if (gen !== generationRef.current) {
        savePromiseRef.current = null;
        return result;
      }
      savePromiseRef.current = null;
      setSaveInFlight(false);
      if (result.ok) {
        setLastSaveError(undefined);
        // 成功: 调用方在 commit 内已决定是否 cancel; 这里回到 ready (buffer 仍可能在,
        // 但 dirty 已被 editor 在 commit 成功路径清掉)。若 editor 已 cancel → active=false,
        // 调用方应再切 idle; 简化: 只要还 active 就回 ready。
        setPhase(editor.active ? "ready" : "idle");
      } else {
        setLastSaveError(result.error);
        setPhase("error");
      }
      return result;
    }).catch((error: unknown) => {
      if (gen !== generationRef.current) {
        savePromiseRef.current = null;
        throw error;
      }
      savePromiseRef.current = null;
      setSaveInFlight(false);
      setLastSaveError(error);
      setPhase("error");
      throw error;
    });
    savePromiseRef.current = promise;
    return promise;
  }, [editor.active]);

  const recoverFromError = useCallback(() => {
    setLastSaveError(undefined);
    // 回到 dirty: buffer/history 仍在, 用户继续编辑或手动 retry。
    setPhase(editor.dirty ? "dirty" : "ready");
  }, [editor.dirty]);

  return {
    ...editor,
    phase,
    sessionId,
    generation,
    lastSaveError,
    saveInFlight,
    loadRle,
    loadBlank,
    save,
    recoverFromError,
  };
}
