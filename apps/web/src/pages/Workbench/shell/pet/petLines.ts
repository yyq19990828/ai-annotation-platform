// 工作台桌宠话术池 + 里程碑常量(纯前端,v1 仅陪伴层)。
// 形式可皮、数据不可皮:这里只产文案,不触碰任何标注数据。

export type PetMood =
  | "idle"
  | "idleTalk"
  | "holding"
  | "selected"
  | "multiSelected"
  | "aiRunning"
  | "candidateReady"
  | "warning"
  | "offline"
  | "review"
  | "happy"
  | "celebrate";

/** 标注总数踩到这些值时放「庆祝」动效。 */
export const MILESTONES = [10, 25, 50, 100, 200, 500, 1000] as const;

type LineKey = "idleTalk" | "poke" | "happy" | "celebrate";

const LINES: Record<LineKey, readonly string[]> = {
  // 久坐 / 长停顿时冒泡
  idleTalk: [
    "可以休息一下眼睛",
    "要不要伸个懒腰?",
    "这张图先慢慢看",
    "喝口水再继续",
    "我在这儿,慢慢来",
    "盯久了记得眨眨眼",
  ],
  // 戳一下桌宠
  poke: ["在的", "我守着当前题", "继续看画布", "需要时点我展开"],
  // 标注数 +1
  happy: ["+1", "已记下", "稳", "继续"],
  // 里程碑(count 走专属文案)
  celebrate: ["里程碑达成", "进度不错", "又上一个台阶"],
};

export function pickLine(key: LineKey, count?: number): string {
  if (key === "celebrate" && typeof count === "number") {
    return `${count} 个达成`;
  }
  const pool = LINES[key];
  return pool[Math.floor(Math.random() * pool.length)];
}
