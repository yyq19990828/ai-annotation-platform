/**
 * 给 vitepress-plugin-mermaid 渲染出的静态 SVG 挂上「滚轮缩放 + 拖动平移」能力。
 *
 * 原理：插件把每张图渲染成 `<svg id="mermaid-...">`（客户端异步生成）。这里用
 * MutationObserver 捕获新出现的 mermaid SVG，给每张套一个定高容器并初始化 svg-pan-zoom，
 * 附带 +/−/复位控制按钮。鼠标在图上滚轮缩放（此时页面不滚动）、按住拖动平移。
 */

import type svgPanZoomFn from "svg-pan-zoom";

const ZOOM_VIEWPORT_RATIO = 0.7; // 容器高度上限 = 视口高的 70%
const MIN_BOX_HEIGHT = 240;

export function setupMermaidZoom(): void {
  if (typeof window === "undefined") return; // SSR 构建期跳过

  let svgPanZoom: typeof svgPanZoomFn | null = null;

  const initOne = async (svg: SVGSVGElement) => {
    if (svg.dataset.zoomReady) return;
    // mermaid 偶尔分两步渲染，没 viewBox 时先跳过，等下一次 mutation 再处理
    const vb = svg.viewBox?.baseVal;
    if (!vb || vb.width === 0) return;
    svg.dataset.zoomReady = "1";

    if (!svgPanZoom) {
      svgPanZoom = (await import("svg-pan-zoom")).default;
    }

    const natural = svg.getBoundingClientRect().height || 320;
    const boxH = Math.max(
      MIN_BOX_HEIGHT,
      Math.min(natural, Math.round(window.innerHeight * ZOOM_VIEWPORT_RATIO)),
    );

    const wrapper = document.createElement("div");
    wrapper.className = "mermaid-zoom";
    wrapper.style.height = `${boxH}px`;
    svg.parentNode?.insertBefore(wrapper, svg);
    wrapper.appendChild(svg);

    // svg-pan-zoom 要求 svg 有「绝对像素」宽高，mermaid 默认给的是 width="100%" + max-width，
    // 会让控件图标和 fit 计算全乱。这里换成与容器一致的 px 尺寸（viewBox 保留，由库接管）。
    svg.style.maxWidth = "none";
    svg.style.width = "";
    svg.style.height = "";
    const applyPxSize = () => {
      svg.setAttribute("width", String(wrapper.clientWidth));
      svg.setAttribute("height", String(wrapper.clientHeight));
    };
    applyPxSize();

    const instance = svgPanZoom!(svg, {
      zoomEnabled: true,
      controlIconsEnabled: false, // 内置图标和 mermaid svg 配合会被放大成巨型遮罩，改用下面自定义按钮
      fit: true,
      center: true,
      minZoom: 0.4,
      maxZoom: 15,
      zoomScaleSensitivity: 0.3,
      mouseWheelZoomEnabled: true,
      dblClickZoomEnabled: false,
    });

    // 自定义 +/−/复位 按钮（HTML，叠在容器右上角，不进 svg 坐标系，规避巨型图标 bug）
    const mkBtn = (label: string, title: string, onClick: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "mermaid-zoom-btn";
      b.textContent = label;
      b.title = title;
      b.addEventListener("click", (e) => {
        e.preventDefault();
        onClick();
      });
      return b;
    };
    const bar = document.createElement("div");
    bar.className = "mermaid-zoom-ctrl";
    bar.append(
      mkBtn("+", "放大", () => instance.zoomIn()),
      mkBtn("−", "缩小", () => instance.zoomOut()),
      mkBtn("⟲", "复位", () => {
        instance.reset();
        instance.fit();
        instance.center();
      }),
    );
    wrapper.appendChild(bar);

    // 容器尺寸变化（窗口缩放 / 用户拖拽改高）后重新贴合居中
    new ResizeObserver(() => {
      applyPxSize();
      instance.resize();
      instance.fit();
      instance.center();
    }).observe(wrapper);
  };

  const scan = () => {
    document
      .querySelectorAll<SVGSVGElement>('svg[id^="mermaid-"]')
      .forEach((svg) => void initOne(svg));
  };

  // mermaid 客户端异步渲染（onMounted 后注入 svg），用 MutationObserver 捕获注入时机。
  // observer 必须存引用，否则初次 scan 后无引用可能被 GC 回收，再不触发。
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      scan();
    });
  };
  const observer = new MutationObserver(schedule);

  const start = () => {
    observer.observe(document.body, { childList: true, subtree: true });
    scan();
    // 兜底：observer 偶尔错过首屏注入时机，补几次延时扫描
    [300, 1000, 2500].forEach((d) => setTimeout(scan, d));
  };

  if (document.body) start();
  else window.addEventListener("DOMContentLoaded", start);
}
