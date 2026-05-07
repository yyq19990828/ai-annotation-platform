/**
 * Cloudflare Turnstile loader (v0.8.7).
 *
 * `VITE_TURNSTILE_SITE_KEY` 缺省时 noop —— 本地开发不阻断注册流。
 * 启用时动态注入官方 api.js（async defer），并暴露 render/reset 封装。
 */

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: string | HTMLElement,
        options: {
          sitekey: string;
          callback?: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
          theme?: "light" | "dark" | "auto";
          size?: "normal" | "compact" | "invisible";
        },
      ) => string; // widget id
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";
let _scriptPromise: Promise<void> | null = null;

export function getTurnstileSiteKey(): string | null {
  const key = import.meta.env.VITE_TURNSTILE_SITE_KEY;
  return typeof key === "string" && key.length > 0 ? key : null;
}

export function loadTurnstileScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (_scriptPromise) return _scriptPromise;

  _scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src^="${SCRIPT_SRC}"]`,
    );
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("turnstile script failed")));
      return;
    }
    const s = document.createElement("script");
    s.src = `${SCRIPT_SRC}?render=explicit`;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("turnstile script failed"));
    document.head.appendChild(s);
  });
  return _scriptPromise;
}

export interface RenderOptions {
  onToken: (token: string) => void;
  onError?: () => void;
  onExpired?: () => void;
  theme?: "light" | "dark" | "auto";
}

export async function renderTurnstile(
  container: HTMLElement,
  sitekey: string,
  opts: RenderOptions,
): Promise<string | null> {
  await loadTurnstileScript();
  if (!window.turnstile) return null;
  return window.turnstile.render(container, {
    sitekey,
    theme: opts.theme ?? "auto",
    callback: opts.onToken,
    "error-callback": opts.onError,
    "expired-callback": opts.onExpired,
  });
}

export function resetTurnstile(widgetId: string | null) {
  if (window.turnstile && widgetId) window.turnstile.reset(widgetId);
}

export function removeTurnstile(widgetId: string | null) {
  if (window.turnstile && widgetId) window.turnstile.remove(widgetId);
}
