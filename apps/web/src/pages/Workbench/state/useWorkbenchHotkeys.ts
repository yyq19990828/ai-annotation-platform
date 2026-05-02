// v0.6.4 P1：从 WorkbenchShell 拆出的键盘快捷键接线层。
//
// 集中管理：
//  - polygon 专用键（Enter / Esc / Backspace，capture 阶段拦截）
//  - 主 keydown 通过 dispatchKey 路由所有 action
//  - keyup 释放空格 / 方向键时 flush nudge
//  - 方向键 nudge 临时几何 override（state 与 ref 共用）
//
// 不在这里管的：dispatchKey 自身（state/hotkeys.ts，纯函数不动）、
// AnnotationActions handler（state/useWorkbenchAnnotationActions.ts）。

import { useCallback, useEffect, useRef, useState } from "react";

import { dispatchKey, ARROW_KEY_SET } from "./hotkeys";
import { recordHotkeyUsage } from "./hotkeyUsage";
import { bboxGeom } from "./transforms";
import type { useWorkbenchState } from "./useWorkbenchState";
import type { useAnnotationHistory } from "./useAnnotationHistory";
import type { AnnotationResponse } from "@/types";
import type { AiBox } from "./transforms";

type Geom = { x: number; y: number; w: number; h: number };

interface ToastInput {
  msg: string;
  sub?: string;
  kind?: "success" | "warning" | "error" | "";
}

interface ProjectAttributeSchemaLite {
  attribute_schema?: { fields?: { key: string; type: string; hotkey?: string | null; applies_to?: unknown; options?: { value: string; label: string }[] | null }[] } | null;
}

interface ClipboardLike {
  hasClipboard: boolean;
  copySelection: () => number;
  paste: () => Promise<string[]>;
  duplicateSelection: () => Promise<string[]>;
}

interface UpdateMutationLike {
  mutate: (vars: { annotationId: string; payload: { geometry: ReturnType<typeof bboxGeom> } }) => void;
}

export interface UseWorkbenchHotkeysArgs {
  s: ReturnType<typeof useWorkbenchState>;
  history: ReturnType<typeof useAnnotationHistory>;
  classes: string[];
  currentProject: ProjectAttributeSchemaLite | null | undefined;
  annotationsRef: { current: AnnotationResponse[] };
  batchChanging: boolean;
  setBatchChanging: React.Dispatch<React.SetStateAction<boolean>>;
  showHotkeys: boolean;

  // navigation / task helpers
  navigateTask: (dir: "next" | "prev") => void;
  smartNext: (mode: "open" | "uncertain") => void;
  setFitTick: React.Dispatch<React.SetStateAction<number>>;

  // class / attribute / annotation actions
  recordRecentClass: (cls: string) => void;
  handleDeleteBox: (id: string) => void;
  handleBatchDelete: () => void;
  handleStartChangeClass: (id: string) => void;
  handleStartBatchChangeClass: () => void;
  handleSubmitTask: () => void;
  handleAcceptPrediction: (b: AiBox) => void;
  handleUpdateAttributes: (id: string, attrs: Record<string, unknown>) => void;

  // ai
  aiBoxes: AiBox[];

  // ui state setters
  setShowHotkeys: React.Dispatch<React.SetStateAction<boolean>>;

  // clipboard
  clipboard: ClipboardLike;

  // toast
  pushToast: (toast: ToastInput) => void;

  // stage geom for nudge calc
  stageGeom: { imgW: number; imgH: number };

  // polygon hookup（来自 AnnotationActions hook）
  polygonDraftPoints: [number, number][];
  setPolygonDraftPoints: React.Dispatch<React.SetStateAction<[number, number][]>>;
  submitPolygon: (points: [number, number][]) => void;

  // nudge 提交所用 mutation
  updateMutation: UpdateMutationLike;

  // 切题（清 nudge）
  taskId: string | undefined;
}

export interface UseWorkbenchHotkeysReturn {
  spacePan: boolean;
  nudgeMap: Map<string, Geom>;
  flushNudges: () => void;
}

export function useWorkbenchHotkeys(args: UseWorkbenchHotkeysArgs): UseWorkbenchHotkeysReturn {
  const {
    s, history, classes, currentProject, annotationsRef, batchChanging, setBatchChanging, showHotkeys,
    navigateTask, smartNext, setFitTick,
    recordRecentClass, handleDeleteBox, handleBatchDelete,
    handleStartChangeClass, handleStartBatchChangeClass,
    handleSubmitTask, handleAcceptPrediction, handleUpdateAttributes,
    aiBoxes, setShowHotkeys, clipboard, pushToast, stageGeom,
    polygonDraftPoints, setPolygonDraftPoints, submitPolygon,
    updateMutation, taskId,
  } = args;

  const [spacePan, setSpacePan] = useState(false);
  const [nudgeMap, setNudgeMap] = useState<Map<string, Geom>>(new Map());
  const nudgeOrigRef = useRef<Map<string, Geom>>(new Map());

  // 切题清空 nudge
  useEffect(() => {
    setNudgeMap(new Map());
    nudgeOrigRef.current = new Map();
  }, [taskId]);

  const flushNudges = useCallback(() => {
    if (nudgeMap.size === 0) return;
    const cmds: { kind: "update"; annotationId: string; before: { geometry: ReturnType<typeof bboxGeom> }; after: { geometry: ReturnType<typeof bboxGeom> } }[] = [];
    nudgeMap.forEach((after, id) => {
      const before = nudgeOrigRef.current.get(id);
      if (!before) return;
      if (before.x === after.x && before.y === after.y && before.w === after.w && before.h === after.h) return;
      const beforeG = bboxGeom(before);
      const afterG = bboxGeom(after);
      updateMutation.mutate({ annotationId: id, payload: { geometry: afterG } });
      cmds.push({ kind: "update", annotationId: id, before: { geometry: beforeG }, after: { geometry: afterG } });
    });
    if (cmds.length > 0) history.pushBatch(cmds);
    setNudgeMap(new Map());
    nudgeOrigRef.current = new Map();
  }, [nudgeMap, updateMutation, history]);

  // polygon 专用键：Enter / Esc / Backspace
  useEffect(() => {
    if (s.tool !== "polygon") return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (polygonDraftPoints.length === 0) return;
      if (e.key === "Enter" && polygonDraftPoints.length >= 3) {
        e.preventDefault(); e.stopPropagation();
        submitPolygon(polygonDraftPoints);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault(); e.stopPropagation();
        setPolygonDraftPoints([]);
        return;
      }
      if (e.key === "Backspace") {
        e.preventDefault(); e.stopPropagation();
        setPolygonDraftPoints((p) => p.slice(0, -1));
        return;
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [s.tool, polygonDraftPoints, submitPolygon, setPolygonDraftPoints]);

  // 主 keydown / keyup
  useEffect(() => {
    const isInputFocused = (el: EventTarget | null) =>
      el instanceof HTMLElement && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);

    const applyArrowNudge = (dx: number, dy: number) => {
      const userTargets = s.selectedIds
        .map((id) => annotationsRef.current.find((a) => a.id === id))
        .filter(Boolean) as AnnotationResponse[];
      if (userTargets.length === 0) return;
      const w = stageGeom.imgW || 1;
      const h = stageGeom.imgH || 1;
      const ndx = dx / w;
      const ndy = dy / h;
      setNudgeMap((prev) => {
        const next = new Map(prev);
        for (const ann of userTargets) {
          const orig = nudgeOrigRef.current.get(ann.id) ?? (ann.geometry as Geom);
          if (!nudgeOrigRef.current.has(ann.id)) nudgeOrigRef.current.set(ann.id, orig);
          const cur = next.get(ann.id) ?? orig;
          next.set(ann.id, {
            x: Math.max(0, Math.min(1 - cur.w, cur.x + ndx)),
            y: Math.max(0, Math.min(1 - cur.h, cur.y + ndy)),
            w: cur.w, h: cur.h,
          });
        }
        return next;
      });
    };

    const onKey = (e: KeyboardEvent) => {
      const attributeHotkey = (digit: string) => {
        const sel = s.selectedId;
        if (!sel) return null;
        const ann = annotationsRef.current.find((a) => a.id === sel);
        if (!ann) return null;
        const fields = currentProject?.attribute_schema?.fields ?? [];
        for (const f of fields) {
          if (f.hotkey !== digit) continue;
          if (f.type !== "boolean" && f.type !== "select") continue;
          const applies = f.applies_to;
          if (Array.isArray(applies) && !applies.includes(ann.class_name)) continue;
          const cur = (ann.attributes ?? {})[f.key];
          if (f.type === "boolean") {
            return { key: f.key, type: "boolean" as const, currentValue: cur };
          }
          const opts = (f.options ?? []).map((o) => o.value);
          return { key: f.key, type: "select" as const, options: opts, currentValue: cur };
        }
        return null;
      };

      const action = dispatchKey(e, {
        isInputFocused: isInputFocused(e.target),
        hasSelection: !!s.selectedId || s.selectedIds.length > 0,
        pendingActive: !!s.pendingDrawing || !!s.editingClass || batchChanging,
        attributeHotkey,
      });
      if (!action) return;
      recordHotkeyUsage(action.type);

      switch (action.type) {
        case "undo": e.preventDefault(); history.undo(); return;
        case "redo": e.preventDefault(); history.redo(); return;
        case "fitReset": e.preventDefault(); setFitTick((n) => n + 1); return;
        case "navigateTask": e.preventDefault(); navigateTask(action.dir); return;

        case "selectAllUser":
          e.preventDefault();
          if (annotationsRef.current.length > 0) {
            s.replaceSelected(annotationsRef.current.map((a) => a.id));
          }
          return;

        case "copy": {
          e.preventDefault();
          const n = clipboard.copySelection();
          if (n > 0) pushToast({ msg: `已复制 ${n} 个标注`, kind: "success" });
          return;
        }
        case "paste":
          e.preventDefault();
          if (clipboard.hasClipboard) {
            clipboard.paste().then((ids) => {
              if (ids.length > 0) pushToast({ msg: `已粘贴 ${ids.length} 个标注`, kind: "success" });
            });
          }
          return;
        case "duplicate":
          e.preventDefault();
          if (s.selectedIds.length > 0) {
            clipboard.duplicateSelection().then((ids) => {
              if (ids.length > 0) pushToast({ msg: `已复制 ${ids.length} 个标注`, kind: "success" });
            });
          }
          return;

        case "arrowNudge": {
          const hasUser = s.selectedIds.some((id) =>
            annotationsRef.current.some((a) => a.id === id),
          );
          if (!hasUser) return;
          e.preventDefault();
          applyArrowNudge(action.dx, action.dy);
          return;
        }

        case "spacePanOn": e.preventDefault(); setSpacePan(true); return;
        case "showHotkeys": setShowHotkeys(true); return;
        case "cancel":
          if (showHotkeys) { setShowHotkeys(false); return; }
          if (batchChanging) { setBatchChanging(false); return; }
          if (s.pendingDrawing) { s.setPendingDrawing(null); return; }
          if (s.editingClass) { s.setEditingClass(null); return; }
          s.setSelectedId(null);
          return;

        case "thresholdAdjust":
          e.preventDefault();
          s.setConfThreshold(Math.max(0, Math.min(1, +(s.confThreshold + action.delta).toFixed(2))));
          return;

        case "cycleUser": {
          const list = annotationsRef.current;
          if (list.length === 0) return;
          e.preventDefault();
          const idxNow = s.selectedId ? list.findIndex((a) => a.id === s.selectedId) : -1;
          let next: number;
          if (action.loop) {
            next = (idxNow + action.dir + list.length) % list.length;
          } else {
            next = Math.max(0, Math.min(list.length - 1, idxNow < 0 ? 0 : idxNow + action.dir));
          }
          s.setSelectedId(list[next].id);
          return;
        }

        case "smartNext": smartNext(action.mode); return;

        case "changeClass": {
          const userIds = s.selectedIds.filter((id) =>
            annotationsRef.current.some((a) => a.id === id),
          );
          if (userIds.length > 1) handleStartBatchChangeClass();
          else if (userIds.length === 1) handleStartChangeClass(userIds[0]);
          return;
        }

        case "setTool": s.setTool(action.tool); return;

        case "setClassByDigit":
          if (classes[action.idx]) { s.setActiveClass(classes[action.idx]); recordRecentClass(classes[action.idx]); }
          return;

        case "setAttribute": {
          e.preventDefault();
          if (!s.selectedId) return;
          const ann = annotationsRef.current.find((a) => a.id === s.selectedId);
          if (!ann) return;
          const next = { ...(ann.attributes ?? {}), [action.key]: action.value };
          handleUpdateAttributes(ann.id, next);
          return;
        }

        case "setClassByLetter": {
          const letterIdx = action.letter.charCodeAt(0) - "a".charCodeAt(0);
          const idx = 9 + letterIdx;
          if (classes[idx]) { s.setActiveClass(classes[idx]); recordRecentClass(classes[idx]); }
          return;
        }

        case "deleteSelected": {
          const userIds = s.selectedIds.filter((id) =>
            annotationsRef.current.some((a) => a.id === id),
          );
          if (userIds.length > 1) handleBatchDelete();
          else if (userIds.length === 1) handleDeleteBox(userIds[0]);
          return;
        }

        case "submit": handleSubmitTask(); return;

        case "acceptAi": {
          if (!s.selectedId) return;
          const aiBox = aiBoxes.find((b) => b.id === s.selectedId);
          if (aiBox) handleAcceptPrediction(aiBox);
          return;
        }
        case "rejectAi": {
          if (!s.selectedId) return;
          const aiBox = aiBoxes.find((b) => b.id === s.selectedId);
          if (aiBox) s.setSelectedId(null);
          return;
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") setSpacePan(false);
      if (ARROW_KEY_SET.has(e.key)) flushNudges();
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [
    s, history, classes, currentProject, annotationsRef, batchChanging, setBatchChanging, showHotkeys,
    navigateTask, smartNext, setFitTick,
    recordRecentClass, handleDeleteBox, handleBatchDelete,
    handleStartChangeClass, handleStartBatchChangeClass,
    handleSubmitTask, handleAcceptPrediction, handleUpdateAttributes,
    aiBoxes, setShowHotkeys, clipboard, pushToast, stageGeom.imgW, stageGeom.imgH,
    flushNudges,
  ]);

  return { spacePan, nudgeMap, flushNudges };
}
