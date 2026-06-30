// 工作台桌宠话术池 + 里程碑常量(纯前端,v1 仅陪伴层)。
// 形式可皮、数据不可皮:这里只产文案,不触碰任何标注数据。

export type PetMood = "idle" | "idleTalk" | "holding" | "happy" | "celebrate";

/** 标注总数踩到这些值时放「庆祝」动效。 */
export const MILESTONES = [10, 25, 50, 100, 200, 500, 1000] as const;

type LineKey = "idleTalk" | "poke" | "happy" | "celebrate";

const LINES: Record<LineKey, readonly string[]> = {
  // 久坐 / 长停顿时冒泡
  idleTalk: [
    "发会儿呆也没关系~",
    "要不要伸个懒腰?",
    "这张图…我也看不太懂",
    "喝口水再标吧 💧",
    "我在的,慢慢来",
    "盯久了记得眨眨眼",
  ],
  // 戳一下小精灵
  poke: ["戳我干嘛啦", "在的在的!", "嘿嘿~", "需要我帮忙吗?"],
  // 标注数 +1
  happy: ["+1!", "漂亮~", "稳!", "记下了 ✔"],
  // 里程碑(count 走专属文案)
  celebrate: ["里程碑达成! 🎉", "厉害了!", "又上一个台阶 🏆"],
};

export function pickLine(key: LineKey, count?: number): string {
  if (key === "celebrate" && typeof count === "number") {
    return `${count} 个达成! 🎉`;
  }
  const pool = LINES[key];
  return pool[Math.floor(Math.random() * pool.length)];
}
