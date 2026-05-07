import { useCallback, useEffect, useRef, useState } from "react";
import { mlBackendsApi } from "@/api/ml-backends";
import { useToastStore } from "@/components/ui/Toast";

/**
 * v0.9.2 · 工作台 SAM 交互式 hook。
 *
 * 三种 prompt 全部走 `POST /projects/{pid}/ml-backends/{bid}/interactive-annotating`：
 *   point  : ctx { type:"point", points:[[x,y]], labels:[1|0] }
 *   bbox   : ctx { type:"bbox",  bbox:[x1,y1,x2,y2] }
 *   text   : ctx { type:"text",  text }
 * 后端返回 `result[]`，每条形如：
 *   { type:"polygonlabels", value:{ points:[[x,y]...], polygonlabels:[label] }, score }
 *
 * 候选以「待确认紫虚线」叠加到 Konva canvas，由 `<PendingPolygonsOverlay>` 消费。
 *
 * 防抖：runPoint 80ms（轻击 / 多点同图场景）；runBbox / runText 不防抖（一次完整动作）。
 */
export interface PendingCandidate {
  /** 仅用于 React key / 选中态定位 */
  id: string;
  /** 归一化顶点列表 [[0..1, 0..1]...] */
  points: [number, number][];
  /** backend 给的标签（DINO 短语 / SAM 默认 "object"） */
  label: string;
  score: number | null;
  /** 触发该候选的 prompt 类型 */
  source: "point" | "bbox" | "text";
}

export interface UseInteractiveAIArgs {
  projectId: string | undefined;
  taskId: string | undefined;
  mlBackendId: string | undefined | null;
}

export interface UseInteractiveAIReturn {
  candidates: PendingCandidate[];
  activeIdx: number;
  isRunning: boolean;
  runPoint: (pt: [number, number], polarity: 1 | 0) => void;
  runBbox: (bbox: [number, number, number, number]) => void;
  runText: (text: string) => void;
  cycle: (dir: 1 | -1) => void;
  /** 接受一个候选；调用方拿到 candidate 后落库（创建 polygon annotation），随后调 consume(idx) 清除该条。 */
  consume: (idx: number) => void;
  /** 清空所有候选（Esc） */
  cancel: () => void;
}

const DEBOUNCE_MS = 80;

export function useInteractiveAI(args: UseInteractiveAIArgs): UseInteractiveAIReturn {
  const { projectId, taskId, mlBackendId } = args;
  const pushToast = useToastStore((s) => s.push);

  const [candidates, setCandidates] = useState<PendingCandidate[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [isRunning, setIsRunning] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightRef = useRef(0);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const guard = useCallback((): boolean => {
    if (!projectId || !taskId) return false;
    if (!mlBackendId) {
      pushToast({
        msg: "项目未绑定 ML Backend",
        sub: "请先在项目设置中绑定 SAM 后端",
        kind: "error",
      });
      return false;
    }
    return true;
  }, [projectId, taskId, mlBackendId, pushToast]);

  const dispatch = useCallback(
    async (context: Record<string, unknown>, source: PendingCandidate["source"]) => {
      if (!projectId || !taskId || !mlBackendId) return;
      const myInflight = ++inflightRef.current;
      setIsRunning(true);
      try {
        const resp = await mlBackendsApi.interactiveAnnotate(projectId, mlBackendId, {
          task_id: taskId,
          context,
        });
        // 只接受最新一次请求的结果（防止防抖窗口外的旧请求覆盖新候选）
        if (myInflight !== inflightRef.current) return;
        const next: PendingCandidate[] = (resp.result ?? [])
          .map((r, i) => normalizeResult(r, i, source))
          .filter((c): c is PendingCandidate => c !== null);
        setCandidates(next);
        setActiveIdx(0);
        if (next.length === 0) {
          pushToast({
            msg: "SAM 未返回候选",
            sub: source === "text" ? "请尝试英文 prompt 或调低阈值" : "请尝试不同的位置/区域",
            kind: "warning",
          });
        }
      } catch (err) {
        if (myInflight !== inflightRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        pushToast({
          msg: "SAM 推理失败",
          sub: msg.slice(0, 80),
          kind: "error",
        });
      } finally {
        if (myInflight === inflightRef.current) setIsRunning(false);
      }
    },
    [projectId, taskId, mlBackendId, pushToast],
  );

  const runPoint = useCallback(
    (pt: [number, number], polarity: 1 | 0) => {
      if (!guard()) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        dispatch(
          { type: "point", points: [pt], labels: [polarity] },
          "point",
        );
      }, DEBOUNCE_MS);
    },
    [guard, dispatch],
  );

  const runBbox = useCallback(
    (bbox: [number, number, number, number]) => {
      if (!guard()) return;
      dispatch({ type: "bbox", bbox }, "bbox");
    },
    [guard, dispatch],
  );

  const runText = useCallback(
    (text: string) => {
      if (!guard()) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      dispatch({ type: "text", text: trimmed }, "text");
    },
    [guard, dispatch],
  );

  const cycleStable = useCallback(
    (dir: 1 | -1) => {
      setActiveIdx((i) => {
        const n = candidates.length;
        if (n === 0) return 0;
        return ((i + dir) % n + n) % n;
      });
    },
    [candidates.length],
  );

  const consume = useCallback((idx: number) => {
    setCandidates((prev) => prev.filter((_, i) => i !== idx));
    setActiveIdx((i) => Math.max(0, i >= idx ? i - 1 : i));
  }, []);

  const cancel = useCallback(() => {
    setCandidates([]);
    setActiveIdx(0);
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  return {
    candidates,
    activeIdx,
    isRunning,
    runPoint,
    runBbox,
    runText,
    cycle: cycleStable,
    consume,
    cancel,
  };
}

// ── helpers ───────────────────────────────────────────────────────────────────

interface BackendPolygonResult {
  type?: string;
  value?: {
    points?: [number, number][];
    polygonlabels?: string[];
  };
  score?: number;
}

function normalizeResult(
  raw: unknown,
  idx: number,
  source: PendingCandidate["source"],
): PendingCandidate | null {
  const r = raw as BackendPolygonResult;
  const pts = r?.value?.points;
  if (!Array.isArray(pts) || pts.length < 3) return null;
  return {
    id: `sam-${Date.now()}-${idx}`,
    points: pts.map(([x, y]) => [x, y]) as [number, number][],
    label: r.value?.polygonlabels?.[0] ?? "object",
    score: typeof r.score === "number" ? r.score : null,
    source,
  };
}
