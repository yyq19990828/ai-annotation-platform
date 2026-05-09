/**
 * M2 · 截图自动注释：截图前向页面注入临时 SVG overlay，截图后清除。
 *
 * 支持 rect-red / rect-blue / arrow / numbered 四种样式。
 * 仅对 page 级截图（fullPage / viewport / clip）生效；locator 截图请用 clip 代替。
 *
 * 使用方式（driver 内部调用）：
 *   const cleanup = await injectAnnotations(page, scene.annotate);
 *   await page.screenshot(...);
 *   await cleanup();
 */
import type { Page } from "@playwright/test";

export type AnnotateEntry = {
  selector: string;
  style?: "rect-red" | "rect-blue" | "arrow" | "numbered";
  label?: string;
};

const STYLE_CONFIG: Record<
  NonNullable<AnnotateEntry["style"]>,
  { stroke: string; fill: string }
> = {
  "rect-red":  { stroke: "#E53E3E", fill: "rgba(229,62,62,0.08)" },
  "rect-blue": { stroke: "#3182CE", fill: "rgba(49,130,206,0.08)" },
  "arrow":     { stroke: "#D69E2E", fill: "rgba(214,158,46,0.08)" },
  "numbered":  { stroke: "#38A169", fill: "rgba(56,161,105,0.08)" },
};

/** 注入 SVG overlay；返回清除函数。 */
export async function injectAnnotations(
  page: Page,
  entries: AnnotateEntry[] | undefined,
): Promise<() => Promise<void>> {
  if (!entries || entries.length === 0) return async () => {};

  type BoxEntry = {
    x: number; y: number; width: number; height: number;
    style: NonNullable<AnnotateEntry["style"]>;
    label?: string;
    index: number;
  };

  // 收集所有元素的 boundingBox
  // timeout:0 → 不等待元素出现，若当前 DOM 中不存在则跳过（避免超时）
  const boxes: BoxEntry[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const style = entry.style ?? "rect-red";
    const locator = page.locator(entry.selector).first();
    let box: { x: number; y: number; width: number; height: number } | null = null;
    try {
      box = await locator.boundingBox({ timeout: 0 } as Parameters<typeof locator.boundingBox>[0]);
    } catch {
      // 元素不存在或不可见，跳过此注释条目
    }
    if (!box) continue;
    boxes.push({ ...box, style, label: entry.label, index: i + 1 });
  }

  if (boxes.length === 0) return async () => {};

  // 向页面注入 SVG overlay（position:fixed，pointer-events:none，z-index:99998）
  const overlayId = "__anno_overlay_" + Date.now();
  await page.evaluate(
    ({ boxes: bs, id, styleConfig }) => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("id", id);
      svg.setAttribute("width", String(vw));
      svg.setAttribute("height", String(vh));
      svg.style.cssText = [
        "position:fixed", "top:0", "left:0", "width:100%", "height:100%",
        "pointer-events:none", "z-index:99998",
      ].join(";");

      for (const b of bs) {
        const cfg = (styleConfig as Record<string, { stroke: string; fill: string }>)[b.style];
        // 矩形框
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("x", String(b.x));
        rect.setAttribute("y", String(b.y));
        rect.setAttribute("width",  String(b.width));
        rect.setAttribute("height", String(b.height));
        rect.setAttribute("stroke", cfg.stroke);
        rect.setAttribute("stroke-width", "2");
        rect.setAttribute("fill", cfg.fill);
        rect.setAttribute("rx", "3");
        svg.appendChild(rect);

        // numbered 模式：左上角编号圆圈
        if (b.style === "numbered") {
          const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          circle.setAttribute("cx", String(b.x + 10));
          circle.setAttribute("cy", String(b.y - 10));
          circle.setAttribute("r", "10");
          circle.setAttribute("fill", cfg.stroke);
          svg.appendChild(circle);

          const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
          text.setAttribute("x", String(b.x + 10));
          text.setAttribute("y", String(b.y - 5));
          text.setAttribute("text-anchor", "middle");
          text.setAttribute("fill", "#fff");
          text.setAttribute("font-size", "11");
          text.setAttribute("font-family", "sans-serif");
          text.setAttribute("font-weight", "bold");
          text.textContent = String(b.index);
          svg.appendChild(text);
        }

        // label 文字（显示在框右上方）
        if (b.label) {
          const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
          const textX = b.x + b.width + 4;
          const textY = b.y - 18;
          bg.setAttribute("x", String(textX - 2));
          bg.setAttribute("y", String(textY));
          bg.setAttribute("width", String(b.label.length * 7 + 4));
          bg.setAttribute("height", "16");
          bg.setAttribute("fill", cfg.stroke);
          bg.setAttribute("rx", "2");
          svg.appendChild(bg);

          const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
          text.setAttribute("x", String(textX));
          text.setAttribute("y", String(textY + 12));
          text.setAttribute("fill", "#fff");
          text.setAttribute("font-size", "11");
          text.setAttribute("font-family", "sans-serif");
          text.textContent = b.label;
          svg.appendChild(text);
        }
      }

      document.body.appendChild(svg);
    },
    { boxes, id: overlayId, styleConfig: STYLE_CONFIG },
  );

  return async () => {
    await page.evaluate((id) => {
      document.getElementById(id)?.remove();
    }, overlayId);
  };
}
