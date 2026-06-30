import { useEffect, useRef, useState } from "react";
import { MILESTONES, pickLine, type PetMood } from "./petLines";

const IDLE_MS = 45_000; // 久坐阈值:无操作多久后冒泡
const TALK_HOLD_MS = 6_000; // 一句话停留时长
const HAPPY_MS = 1_800;
const CELEBRATE_MS = 3_400;

export interface PetMoodResult {
  mood: PetMood;
  /** 气泡文字;holding 态为 null(改由调用方用 selectionTitle 举牌)。 */
  line: string | null;
}

interface UsePetMoodArgs {
  hasSelection: boolean;
  collapsed: boolean;
  annotationCount: number;
  /** 点击计数:每 +1 触发一句「戳一下」彩蛋。 */
  poke: number;
}

/**
 * 桌宠情绪状态机(v1 纯陪伴):
 * - 标注数增长 → happy / 踩里程碑 → celebrate(纯响应式派生,不挂任何 mutation)
 * - 无选中且久坐 → idleTalk
 * - 有选中且折叠 → holding(由调用方举牌显类别名)
 * 优先级:transient(happy/celebrate) > holding > idleTalk > idle。
 */
export function usePetMood({
  hasSelection,
  collapsed,
  annotationCount,
  poke,
}: UsePetMoodArgs): PetMoodResult {
  const [transient, setTransient] = useState<{
    mood: "happy" | "celebrate";
    line: string;
  } | null>(null);
  const [idleTalk, setIdleTalk] = useState<string | null>(null);

  // 标注总数 +1 → 短暂情绪反应。只认「恰好多一个」:切换任务 / 图片时计数会跳变,
  // AI 批量采纳是多增量,都不会误触;单次手工新增才是真正的 +1。
  const prevCount = useRef(annotationCount);
  useEffect(() => {
    const prev = prevCount.current;
    prevCount.current = annotationCount;
    if (annotationCount === prev + 1) {
      const milestone = (MILESTONES as readonly number[]).includes(annotationCount);
      setTransient({
        mood: milestone ? "celebrate" : "happy",
        line: pickLine(milestone ? "celebrate" : "happy", annotationCount),
      });
    }
  }, [annotationCount]);

  useEffect(() => {
    if (!transient) return;
    const ms = transient.mood === "celebrate" ? CELEBRATE_MS : HAPPY_MS;
    const t = window.setTimeout(() => setTransient(null), ms);
    return () => window.clearTimeout(t);
  }, [transient]);

  // 戳一下 → 随机彩蛋。
  useEffect(() => {
    if (poke === 0) return;
    setIdleTalk(pickLine("poke"));
    const t = window.setTimeout(() => setIdleTalk(null), TALK_HOLD_MS);
    return () => window.clearTimeout(t);
  }, [poke]);

  // 久坐检测(仅无选中时;有选中代表在干活,不打扰)。1s 轮询,低开销。
  const lastActivity = useRef(Date.now());
  useEffect(() => {
    if (hasSelection) {
      setIdleTalk(null);
      return;
    }
    let talking = false;
    const bump = () => {
      lastActivity.current = Date.now();
      if (talking) {
        talking = false;
        setIdleTalk(null);
      }
    };
    window.addEventListener("pointermove", bump, { passive: true });
    window.addEventListener("keydown", bump);
    const iv = window.setInterval(() => {
      if (talking) return;
      if (Date.now() - lastActivity.current >= IDLE_MS) {
        talking = true;
        setIdleTalk(pickLine("idleTalk"));
        window.setTimeout(() => {
          talking = false;
          setIdleTalk(null);
          lastActivity.current = Date.now();
        }, TALK_HOLD_MS);
      }
    }, 1_000);
    return () => {
      window.clearInterval(iv);
      window.removeEventListener("pointermove", bump);
      window.removeEventListener("keydown", bump);
    };
  }, [hasSelection]);

  if (transient) return { mood: transient.mood, line: transient.line };
  if (hasSelection && collapsed) return { mood: "holding", line: null };
  if (idleTalk) return { mood: "idleTalk", line: idleTalk };
  return { mood: "idle", line: null };
}
