/**
 * 正文图片点击放大（轻量 lightbox）。
 *
 * 让 `.vp-doc` 内的截图可点击放大到全屏查看，避免很高/很宽的截图在正文里被
 * 压成不可读细条。用事件委托，跨路由持续生效；只在浏览器端初始化。
 *
 * 跳过：已被 <a> 包裹的图、显式标记 `.no-zoom` 的图、以及很小的图标类图片。
 */
export function setupImageZoom(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  // 防止重复初始化（HMR / 多次 enhanceApp）
  if ((window as unknown as { __docsImageZoom?: boolean }).__docsImageZoom) return;
  (window as unknown as { __docsImageZoom?: boolean }).__docsImageZoom = true;

  let overlay: HTMLDivElement | null = null;

  const close = (): void => {
    if (!overlay) return;
    overlay.classList.remove("open");
    overlay.replaceChildren();
    document.documentElement.style.overflow = "";
  };

  const ensureOverlay = (): HTMLDivElement => {
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.className = "docs-image-lightbox";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "图片放大预览");
    overlay.addEventListener("click", close);
    document.body.appendChild(overlay);
    return overlay;
  };

  const open = (src: string, alt: string): void => {
    const o = ensureOverlay();
    o.replaceChildren();
    const img = document.createElement("img");
    img.src = src;
    img.alt = alt;
    o.appendChild(img);
    o.classList.add("open");
    document.documentElement.style.overflow = "hidden";
  };

  document.addEventListener("click", (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (!(target instanceof HTMLImageElement)) return;
    if (!target.closest(".vp-doc")) return;
    if (target.closest("a")) return; // 已是链接的图不拦截
    if (target.classList.contains("no-zoom")) return;
    if (target.naturalWidth && target.naturalWidth < 80) return; // 跳过图标
    e.preventDefault();
    open(target.currentSrc || target.src, target.alt || "");
  });

  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  });
}
