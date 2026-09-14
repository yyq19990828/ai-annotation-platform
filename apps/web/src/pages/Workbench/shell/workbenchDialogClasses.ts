/**
 * 工作台居中悬浮面板(设置 / 快捷键 / 标注指引)共享的对话框几何与遮罩。
 *
 * 三个入口来自同一类「悬浮大面板」,必须保持同一尺寸、同一遮罩压暗与模糊程度,
 * 否则同类入口的观感会不一致。改这里即三处同步。
 *
 * 遮罩模糊走 `--sc-overlay-blur`(见 styles/shadcn.css),与全局 Modal 遮罩同一程度。
 */
export const WORKBENCH_DIALOG_CONTENT_CLASS =
  "z-app-drawer flex h-dvh max-h-dvh w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-border bg-card p-0 text-foreground motion-reduce:animate-none sm:max-w-none md:h-[min(820px,85dvh)] md:max-h-[calc(100dvh-64px)] md:w-[min(1120px,calc(100vw-64px))] md:rounded-xl";

export const WORKBENCH_DIALOG_OVERLAY_CLASS =
  "z-app-drawer-backdrop bg-black/25 backdrop-blur-overlay motion-reduce:animate-none";
