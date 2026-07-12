/**
 * 首页品牌动效（L3）集中管理。
 *
 * 统一负责：一次性 reveal（IntersectionObserver）、阅读进度线、Hero 截图随滚动
 * 透视、Product Proof 截图透视、Hero 数据图谱指针视差、Hero CTA magnetic。
 *
 * 约束（对应计划 Task 3 / 风险 7、8）：
 * - 所有浏览器对象只在 onMounted 创建、onUnmounted 清理；快速往返滚动不会重复创建。
 * - scroll / pointer 更新经 requestAnimationFrame 合并，避免 layout thrashing。
 * - `prefers-reduced-motion: reduce` 下不进入动效分支：不加 motion-ready，
 *   .reveal 保持 CSS 默认可见态，不绑定滚动/指针监听。
 * - magnetic / 指针视差仅在 fine pointer（桌面）启用，移动端跳过。
 * - reveal 采用渐进增强：无 JS 时 .reveal 默认可见，只有确认可用动效后才加
 *   `home-motion-ready`，由 CSS 把未进入视口的 .reveal 切到隐藏待显态。
 */
import { onMounted, onUnmounted, type Ref } from "vue";

export function useHomeMotion(rootRef: Ref<HTMLElement | null>): void {
  let io: IntersectionObserver | null = null;
  let onScroll: (() => void) | null = null;
  let onPointer: ((e: PointerEvent) => void) | null = null;
  const magneticCleanups: Array<() => void> = [];
  let rafScroll = 0;
  let rafPointer = 0;

  onMounted(() => {
    const root = rootRef.value;
    if (!root) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const finePointer = window.matchMedia("(pointer: fine)").matches;

    // reduced-motion：静态呈现，reveal 全部保持可见，不绑定任何监听。
    if (reduce) return;

    // 确认动效可用后才切到“先隐藏、进视口再显示”的渐进增强分支。
    root.classList.add("home-motion-ready");

    const reveals = Array.from(root.querySelectorAll<HTMLElement>(".reveal"));
    io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io?.unobserve(e.target);
          }
        });
      },
      { threshold: 0.14 },
    );
    reveals.forEach((el) => io!.observe(el));

    // —— 滚动：阅读进度 + 顶栏透明态 + Hero/Proof 截图透视（RAF 合并）——
    const progress = root.querySelector<HTMLElement>(".home-progress i");
    const figure = root.querySelector<HTMLElement>(".hero-figure");
    const screen = root.querySelector<HTMLElement>(".proof-screen");
    // 顶栏在 VitePress 页面壳层（.docs-home-page）上，不在 .docs-home 内。
    const homePage = document.querySelector<HTMLElement>(".docs-home-page");

    const applyScroll = () => {
      rafScroll = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? window.scrollY / max : 0;
      if (progress) progress.style.width = `${p * 100}%`;
      // Hero 顶部：顶栏透明编辑式；滚过后恢复实心墨黑（默认态）。
      if (homePage) {
        homePage.classList.toggle(
          "home-nav-transparent",
          window.scrollY < window.innerHeight * 0.6,
        );
      }
      // 截图透视只在桌面（fine pointer）启用；移动端保持静态可读（CSS 侧同步拍平）。
      if (finePointer) {
        if (figure) {
          const y = Math.min(window.scrollY, window.innerHeight);
          figure.style.transform = `rotate(${-2.2 + y * 0.0015}deg) translateY(${y * 0.04}px)`;
        }
        if (screen) {
          const r = screen.getBoundingClientRect();
          const t = Math.max(-1, Math.min(1, (r.top - window.innerHeight * 0.5) / window.innerHeight));
          screen.style.transform = `rotateX(${3 + t * 2}deg) scale(${0.96 + Math.max(0, -t) * 0.035})`;
        }
      }
    };
    onScroll = () => {
      if (!rafScroll) rafScroll = requestAnimationFrame(applyScroll);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    applyScroll();

    // —— 指针视差 + magnetic：仅 fine pointer（桌面）——
    if (finePointer) {
      const atlas = root.querySelector<HTMLElement>(".hero-atlas");
      let px = 0;
      let py = 0;
      const applyPointer = () => {
        rafPointer = 0;
        if (atlas) atlas.style.transform = `translate(${px}px, ${py}px)`;
      };
      onPointer = (e: PointerEvent) => {
        px = (e.clientX / window.innerWidth - 0.5) * 8;
        py = (e.clientY / window.innerHeight - 0.5) * 8;
        if (!rafPointer) rafPointer = requestAnimationFrame(applyPointer);
      };
      window.addEventListener("pointermove", onPointer, { passive: true });

      root.querySelectorAll<HTMLElement>(".magnetic").forEach((el) => {
        const move = (e: PointerEvent) => {
          const r = el.getBoundingClientRect();
          el.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.09}px, ${(e.clientY - r.top - r.height / 2) * 0.13}px)`;
        };
        const leave = () => {
          el.style.transform = "";
        };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerleave", leave);
        magneticCleanups.push(() => {
          el.removeEventListener("pointermove", move);
          el.removeEventListener("pointerleave", leave);
        });
      });
    }
  });

  onUnmounted(() => {
    io?.disconnect();
    io = null;
    if (onScroll) window.removeEventListener("scroll", onScroll);
    if (onPointer) window.removeEventListener("pointermove", onPointer);
    if (rafScroll) cancelAnimationFrame(rafScroll);
    if (rafPointer) cancelAnimationFrame(rafPointer);
    magneticCleanups.forEach((fn) => fn());
    magneticCleanups.length = 0;
    // 离开首页时清除叠加在页面壳层上的顶栏透明态，避免残留影响其他页。
    document
      .querySelector(".docs-home-page")
      ?.classList.remove("home-nav-transparent");
  });
}
