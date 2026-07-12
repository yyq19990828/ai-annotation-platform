import { Fragment } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Tooltip } from "@/components/ui/Tooltip";
import { ALL_TOOLS, type CanvasTool, type ToolId } from "../stage/tools";
import { toolUnitForTool } from "../stage/tools/toolUnits";
import type { ThreeDTool, VideoTool } from "../state/useWorkbenchState";

const ROOT_CLASS = "relative flex flex-col items-center gap-1.5 border-r border-border bg-card px-1 py-2.5";
// 仅布局 / 边框宽度，不含颜色 utility —— 颜色按 active / idle 互斥下发，
// 否则朴素 cn() (非 tailwind-merge) 下基础色类会因 CSS 源顺序覆盖激活色类，导致高亮失效。
const TOOL_BTN_CLASS =
  "relative flex size-[38px] cursor-pointer appearance-none items-center justify-center rounded-md border transition-colors";
// 非激活态中性配色 (边框 / 底 / 图标)。
const TOOL_BTN_IDLE = "border-transparent bg-transparent text-muted-foreground";
const TOOL_BTN_HOVER = "hover:bg-muted hover:text-foreground";
// 激活态：实心品牌底 + 白色图标 + 投影，醒目可辨。
const TOOL_BTN_ACTIVE = "border-brand bg-brand text-brand-foreground shadow-sm";
const TOOL_BTN_DISABLED = "cursor-not-allowed opacity-40";
const HOTKEY_BADGE_CLASS =
  "pointer-events-none absolute bottom-px right-[3px] text-3xs font-bold leading-none text-muted-foreground/60";
const HOTKEY_BADGE_ACTIVE = "text-brand-foreground/80";
const DIVIDER_CLASS = "my-1.5 h-px w-[26px] bg-border";

interface ToolDockProps {
  tool: ToolId;
  onSetTool: (t: ToolId) => void;
  videoTool?: VideoTool;
  onSetVideoTool?: (t: VideoTool) => void;
  /** v0.10.2 · 由 useMLCapabilities 注入. tool.requiredPrompt 不在 supported 集合 → 置灰. */
  isPromptSupported?: (type: string) => boolean;
  /** v0.10.2 · capability 加载中: AI 工具组半透 + 不可点 (避免误用回退到的 fallback). */
  capabilitiesLoading?: boolean;
  /** M2 · review 模式下只显示 Hand 工具. */
  reviewMode?: boolean;
  /** v0.9.20 · 视频工作台分离单帧 bbox 与 track 工具. */
  videoMode?: boolean;
  /**
   * 项目已启用的 tool_unit 集合 (来自 project.tool_bindings[unit].enabled)。
   * 过滤所有持有几何的工具 (含 AI 工具, 按其产出几何归属的单位): 未启用的隐藏。
   * null = 老项目无 tool_bindings 配置 → 视为全部启用, 不隐藏任何工具 (向后兼容)。
   */
  enabledToolUnits?: Set<string> | null;
  /**
   * 项目级「交互式 AI 工具」总开关 (project.ai_interactive_enabled, 项目设置「ML 模型」)。
   * false → AI 工具 (requiredPrompt) 整组隐藏。undefined = 未加载 → 不隐藏 (向后兼容)。
   */
  aiInteractiveEnabled?: boolean;
  /**
   * 视频工具可用性谓词 (按几何单位 enabled + 单帧/轨迹子开关判定, 见 stage/videoToolUnits)。
   * undefined = 全部显示 (向后兼容 / 非视频)。
   */
  isVideoToolEnabled?: (t: VideoTool) => boolean;
  /** v0.13.3-5 · 点云 3D 台:渲染 select / box 两个 3D 工具(双栈隔离,不走 2D ToolId)。 */
  threeDMode?: boolean;
  threeDTool?: ThreeDTool;
  onSetThreeDTool?: (t: ThreeDTool) => void;
}

interface ToolDescriptor {
  desc: string;
  altDigit?: number;
}

/** v0.10.2 · Tooltip + Alt+digit 副 hotkey. */
const TOOL_DESCRIPTORS: Record<ToolId, ToolDescriptor> = {
  select: { desc: "点选 / 移动已有标注与预标注 · ESC 回退到它", altDigit: 4 },
  box: { desc: "拖鼠标画矩形框", altDigit: 1 },
  "rotated-box": { desc: "拖框 → 顶部手柄旋转 (OBB)" },
  polygon: { desc: "逐点画多边形 (Enter 闭合)", altDigit: 2 },
  // v0.10.28 · 折线（开放、不闭合）。Enter / 双击结束（≥2 点）。
  polyline: { desc: "逐点画折线 (Enter 结束, 不闭合)" },
  // v0.10.28 · 关键点: 按 schema 依次落点 (Alt 遮挡, 右键跳过), 放满自动提交.
  keypoint: { desc: "依次落关键点 · Alt=遮挡, 右键=跳过" },
  // v0.10.8 · I11 Mask 编辑器：空白笔刷或精修 AI polygon 候选 (B/E 切笔刷/橡皮, Shift+滚轮调半径)。
  mask: { desc: "Mask 笔刷 · B/E 切模式, Shift+滚轮调半径, Enter 提交" },
  "smart-point": { desc: "单击 = 正向点；Alt+点 = 负向点", altDigit: 3 },
  "smart-box": { desc: "拖框作为 SAM 提示" },
  "text-prompt": { desc: "文本召回 (右侧 AI 面板输入)" },
  exemplar: { desc: "拖框示例 → 全图相似实例 (SAM 3)" },
  // v0.10.17 · Magic Box: 粗框 → SAM 收紧到对象紧凑外接矩形 → 落 bbox.
  "magic-box": { desc: "Magic Box · 粗框 → SAM 收紧 → 落 bbox" },
  hand: { desc: "拖拽平移画布", altDigit: 4 },
  canvas: { desc: "评论批注 (内部, 不展示)" },
};

const VIDEO_TOOLS: Array<{
  id: VideoTool;
  label: string;
  icon: IconName;
  desc: string;
  /**
   * 角标与 tooltip 只写**真实绑定**的键(见 hotkeys.ts 的 videoMode 分支)。
   * 之前 polygon 标 G、polyline 标 L 都没绑 —— 而视频 L 是播放 jog, 按下去会快进, 不是「没反应」。
   */
  hotkey?: string;
  /** 视频侧 Alt+数字只绑到 3; 其余工具没有备用数字键, 故可选。 */
  altDigit?: number;
  group: "select" | "static" | "track" | "ai";
  /** 非空 = AI 工具: 受项目总开关(隐藏) + 后端能力(置灰) 双层管控, 对齐图片侧。 */
  requiredPrompt?: string;
}> = [
  { id: "select", hotkey: "V", label: "选择", icon: "cursor", desc: "点选 / 移动已有视频标注", altDigit: 3, group: "select" },
  { id: "box", hotkey: "B", label: "矩形框", icon: "rect", desc: "当前帧独立矩形框", altDigit: 1, group: "static" },
  { id: "track", hotkey: "T", label: "轨迹", icon: "target", desc: "跨帧对象轨迹", altDigit: 2, group: "track" },
  { id: "mask", hotkey: "M", label: "Mask 轨迹", icon: "scissors", desc: "当前帧绘制或编辑逐像素 Mask 关键帧", group: "track" },
  // v0.21.21 · 单帧 polygon/polyline (点击落点, Enter/双击闭合, Esc 取消)。
  { id: "polygon", hotkey: "P", label: "多边形", icon: "polygon", desc: "点击落点画当前帧多边形 · Enter/双击闭合", group: "static" },
  { id: "polyline", label: "折线", icon: "spline", desc: "点击落点画当前帧折线 · Enter/双击结束", group: "static" },
  // v0.21.20 · polygon/polyline 轨迹关键帧 (原 polygon/polyline, 拆分后 -track 后缀)。
  { id: "polygon-track", label: "多边形轨迹", icon: "polygon", desc: "点击落点画多边形轨迹 · Enter/双击闭合", group: "track" },
  { id: "polyline-track", label: "折线轨迹", icon: "spline", desc: "点击落点画折线轨迹 · Enter/双击结束", group: "track" },
  // v0.21.23 · 交互式 SAM 单帧工具; requiredPrompt 决定后端能力门控 (不支持则置灰)。
  { id: "smart-point", hotkey: "S", label: "智能点", icon: "target", desc: "点选目标 · SAM 分割当前帧 · Alt 负点", group: "ai", requiredPrompt: "point" },
  { id: "smart-box", hotkey: "D", label: "智能框", icon: "rect", desc: "框选目标 · SAM 分割当前帧", group: "ai", requiredPrompt: "interactive_box" },
  { id: "exemplar", hotkey: "E", label: "示例框", icon: "sparkles", desc: "框一个例子 · 找出画面里所有同类 · Alt 框排误检", group: "ai", requiredPrompt: "exemplar" },
  { id: "magic-box", hotkey: "G", label: "Magic Box", icon: "wandSparkles", desc: "粗框 → SAM 收紧 → 落矩形框", group: "ai", requiredPrompt: "interactive_box" },
];

// v0.13.3-5 · 点云 3D 工具:select 拾取选中 / box 点地面放置 / point-mask 框选分割。
const THREE_D_TOOLS: Array<{ id: ThreeDTool; hotkey: string; label: string; icon: IconName; desc: string }> = [
  { id: "select", hotkey: "V", label: "选择", icon: "move", desc: "拾取 / 选中 3D 框" },
  { id: "box", hotkey: "B", label: "放置框", icon: "rect", desc: "点地面放置新 3D 框" },
  { id: "point-mask", hotkey: "P", label: "分割", icon: "scissors", desc: "框选点云生成 3D 分割" },
];

function unitForThreeDTool(tool: ThreeDTool): string | null {
  if (tool === "box") return "lidar_box_3d";
  if (tool === "point-mask") return "point_mask_3d";
  return null;
}

const cn = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

/**
 * v0.10.2 · 左侧垂直工具栏 (Prompt-first 重构).
 *
 * 工具分组:
 *   普通绘制: box, polygon
 *   ─── 分隔 ───
 *   AI 工具 (按 prompt 范式): smart-point, smart-box, text-prompt, exemplar
 *     每个工具声明 requiredPrompt; backend 不支持时按钮置灰 + tooltip 提示.
 *     v0.18.25 · 引擎/参数浮块 (InteractiveToolBar) 已移到画布顶部居中 (由 stage overlays 渲染),
 *     不再贴 ToolDock 右侧; ToolDock 只负责工具按钮本身。
 *   ─── 分隔 ───
 *   视图: hand
 */
export function ToolDock({
  tool,
  onSetTool,
  videoTool = "select",
  onSetVideoTool,
  isPromptSupported,
  capabilitiesLoading = false,
  reviewMode = false,
  videoMode = false,
  enabledToolUnits = null,
  aiInteractiveEnabled,
  isVideoToolEnabled,
  threeDMode = false,
  threeDTool = "select",
  onSetThreeDTool,
}: ToolDockProps) {
  if (threeDMode) {
    const visibleThreeDTools = THREE_D_TOOLS.filter((t) => {
      const unit = unitForThreeDTool(t.id);
      if (!unit || !enabledToolUnits) return true;
      return enabledToolUnits.has(unit);
    });
    return (
      <div className={ROOT_CLASS}>
        {visibleThreeDTools.map((t) => {
          const active = threeDTool === t.id;
          return (
            <Tooltip key={t.id} name={t.label} desc={t.desc} hotkey={t.hotkey} side="right" delay={250}>
              <button
                type="button"
                onClick={() => onSetThreeDTool?.(t.id)}
                aria-label={t.label}
                aria-pressed={active}
                data-testid={`three-d-tool-btn-${t.id}`}
                className={cn(TOOL_BTN_CLASS, active ? TOOL_BTN_ACTIVE : cn(TOOL_BTN_IDLE, TOOL_BTN_HOVER))}
              >
                <Icon name={t.icon} size={17} />
                <span aria-hidden className={cn(HOTKEY_BADGE_CLASS, active && HOTKEY_BADGE_ACTIVE)}>
                  {t.hotkey}
                </span>
              </button>
            </Tooltip>
          );
        })}
      </div>
    );
  }
  if (videoMode) {
    // 视频显示选择 + 创建工具；平移走右键/Space 手势, 不占工具按钮。
    // 三层门控与图片侧同构: 项目总开关(隐藏 AI 组) → 后端能力(置灰) → 产出几何单位(隐藏)。
    const visibleVideoTools = VIDEO_TOOLS.filter((t) => {
      if (t.id === "select") return true;
      // 层 1: AI 工具受项目总开关控制 (undefined = 未加载, 不隐藏)。
      if (t.requiredPrompt && aiInteractiveEnabled === false) return false;
      // 层 3: 产出几何所属单位 / 变体未启用 → 隐藏 (AI 工具已登记进 VIDEO_TOOL_TARGET)。
      if (!isVideoToolEnabled) return true;
      return isVideoToolEnabled(t.id);
    });
    return (
      <div className={ROOT_CLASS}>
        {visibleVideoTools.map((t, idx) => {
          const active = videoTool === t.id;
          const prevGroup = idx > 0 ? visibleVideoTools[idx - 1].group : null;
          const showDivider = prevGroup !== null && prevGroup !== t.group;
          // 层 2: 后端不支持该交互模式 → 置灰 + tooltip (不隐藏, 让用户知道工具存在)。
          const supported = t.requiredPrompt
            ? (isPromptSupported ? isPromptSupported(t.requiredPrompt) : true)
            : true;
          const disabled = t.requiredPrompt ? capabilitiesLoading || !supported : false;
          const disabledHint = t.requiredPrompt && !capabilitiesLoading && !supported
            ? "当前后端不支持此交互模式"
            : capabilitiesLoading && t.requiredPrompt
            ? "正在协商后端能力…"
            : null;
          return (
            <Fragment key={t.id}>
              {showDivider && <div aria-hidden className={DIVIDER_CLASS} />}
              <Tooltip
                name={t.label}
                desc={disabledHint ?? (t.altDigit ? `${t.desc} · 备用 Alt+${t.altDigit}` : t.desc)}
                hotkey={t.hotkey}
                side="right"
                delay={250}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (disabled) return;
                    onSetVideoTool?.(t.id);
                  }}
                  aria-label={t.label}
                  aria-pressed={active}
                  aria-disabled={disabled || undefined}
                  disabled={disabled}
                  data-testid={`video-tool-btn-${t.id}`}
                  className={cn(
                    TOOL_BTN_CLASS,
                    active ? TOOL_BTN_ACTIVE : cn(TOOL_BTN_IDLE, !disabled && TOOL_BTN_HOVER),
                    disabled && TOOL_BTN_DISABLED,
                  )}
                >
                  <Icon name={t.icon} size={17} />
                  <span aria-hidden className={cn(HOTKEY_BADGE_CLASS, active && HOTKEY_BADGE_ACTIVE)}>
                    {t.hotkey}
                  </span>
                </button>
              </Tooltip>
            </Fragment>
          );
        })}
      </div>
    );
  }

  // 三层门控 (每层语义单一):
  //   1. 项目总开关 project.ai_interactive_enabled 关 → AI 工具整组隐藏。
  //   2. 后端能力 isPromptSupported 不支持 → 置灰 + tooltip (见下方 disabled 计算)。
  //   3. 产出几何单位未启用 → 隐藏。AI 工具按产出几何归属单位 (smart-* → region,
  //      magic-box → bbox), 故与手画工具同一套过滤: 项目没开 region 单位时,
  //      smart-point 画出的 polygon 无类别可归, 本就该跟随 region 一起隐藏。
  const visibleTools = reviewMode
    ? ALL_TOOLS.filter((t) => t.id === "select")
    : ALL_TOOLS.filter((t) => {
        // select 是选择工具, 不持有几何, 恒显示。
        if (t.id === "select") return true;
        // 层 1: AI 工具受项目总开关控制 (undefined = 未加载, 不隐藏)。
        if (t.requiredPrompt && aiInteractiveEnabled === false) return false;
        // 层 3: 老项目无 tool_bindings → enabledToolUnits 为 null → 全显示 (向后兼容)。
        if (!enabledToolUnits) return true;
        return enabledToolUnits.has(toolUnitForTool(t.id));
      });

  // 分组分隔: 普通绘制 → AI 工具 → 视图工具
  const isAITool = (t: CanvasTool) => !!t.requiredPrompt;
  const groupOf = (t: CanvasTool): "select" | "draw" | "ai" | "view" =>
    t.id === "select" ? "select" : t.id === "hand" ? "view" : isAITool(t) ? "ai" : "draw";

  return (
    <div className={ROOT_CLASS}>
      {visibleTools.map((t, idx) => {
        const active = tool === t.id;
        const prevGroup = idx > 0 ? groupOf(visibleTools[idx - 1]) : null;
        const curGroup = groupOf(t);
        const showDivider = prevGroup !== null && prevGroup !== curGroup;
        const descriptor = TOOL_DESCRIPTORS[t.id];
        const desc = descriptor?.desc ?? "";
        const altDigit = descriptor?.altDigit;
        const tooltipDesc = altDigit ? `${desc} · 备用 Alt+${altDigit}` : desc;
        const requiredPrompt = t.requiredPrompt;
        const supported = requiredPrompt
          ? (isPromptSupported ? isPromptSupported(requiredPrompt) : true)
          : true;
        const disabled = requiredPrompt
          ? capabilitiesLoading || !supported
          : false;
        const disabledHint = requiredPrompt && !capabilitiesLoading && !supported
          ? "当前后端不支持此交互模式"
          : capabilitiesLoading && requiredPrompt
          ? "正在协商后端能力…"
          : null;
        return (
          <Fragment key={t.id}>
            {showDivider && (
              <div aria-hidden className={DIVIDER_CLASS} />
            )}
            <div className="relative flex">
              <Tooltip
                name={t.label}
                desc={disabledHint ?? tooltipDesc}
                hotkey={t.hotkey}
                side="right"
                delay={250}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (disabled) return;
                    onSetTool(t.id);
                  }}
                  aria-label={t.label}
                  aria-pressed={active}
                  aria-disabled={disabled || undefined}
                  data-testid={`tool-btn-${t.id}`}
                  disabled={disabled}
                  className={cn(
                    TOOL_BTN_CLASS,
                    active ? TOOL_BTN_ACTIVE : cn(TOOL_BTN_IDLE, !disabled && TOOL_BTN_HOVER),
                    disabled && TOOL_BTN_DISABLED,
                  )}
                >
                  <Icon name={t.icon as IconName} size={17} />
                  <span
                    aria-hidden
                    className={cn(HOTKEY_BADGE_CLASS, active && HOTKEY_BADGE_ACTIVE)}
                  >
                    {t.hotkey.toUpperCase()}
                  </span>
                </button>
              </Tooltip>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
