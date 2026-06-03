import { Fragment, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Tooltip } from "@/components/ui/Tooltip";
import { ALL_TOOLS, type CanvasTool, type ToolId } from "../stage/tools";
import { toolUnitForTool } from "../stage/tools/toolUnits";
import type { ThreeDTool, VideoTool } from "../state/useWorkbenchState";
import styles from "./ToolDock.module.css";

interface ToolDockProps {
  tool: ToolId;
  onSetTool: (t: ToolId) => void;
  videoTool?: VideoTool;
  onSetVideoTool?: (t: VideoTool) => void;
  /** v0.10.2 · 由 useMLCapabilities 注入. tool.requiredPrompt 不在 supported 集合 → 置灰. */
  isPromptSupported?: (type: string) => boolean;
  /** v0.10.2 · capability 加载中: AI 工具组半透 + 不可点 (避免误用回退到的 fallback). */
  capabilitiesLoading?: boolean;
  /**
   * v0.10.2 · AI 工具激活时由父层渲染的右侧抽屉 (AIToolDrawer).
   * ToolDock 自身不持有 schema/params 状态, 只负责定位.
   */
  aiToolDrawer?: ReactNode;
  /** M2 · review 模式下只显示 Hand 工具. */
  reviewMode?: boolean;
  /** v0.9.20 · 视频工作台分离单帧 bbox 与 track 工具. */
  videoMode?: boolean;
  /**
   * 项目已启用的 tool_unit 集合 (来自 project.tool_bindings[unit].enabled)。
   * 仅过滤普通绘制工具: 未启用的隐藏。AI 工具按后端能力置灰、hand 视图工具恒显示, 均不受此过滤。
   * null = 老项目无 tool_bindings 配置 → 视为全部启用, 不隐藏任何工具 (向后兼容)。
   */
  enabledToolUnits?: Set<string> | null;
  /**
   * v0.11.29 · 视频 bbox 单位的「单帧框 / 轨迹框」子开关 (来自 tool_bindings["bbox"].video_modes)。
   * null / undefined = 两者均显示 (向后兼容老项目)。hand (视图) 工具不受此过滤, 恒显示。
   */
  videoModes?: { box: boolean; track: boolean } | null;
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

// v0.11.29 · group: 单帧 (static) / 轨迹 (track) / 视图 (view), 用于 divider 分组与 video_modes 过滤。
//            为未来 polygon / track-polygon 预留扩展位 (同组追加即可)。
const VIDEO_TOOLS: Array<{ id: VideoTool; hotkey: string; label: string; icon: IconName; desc: string; altDigit: number; group: "static" | "track" | "view" }> = [
  { id: "box", hotkey: "B", label: "矩形框", icon: "rect", desc: "当前帧独立矩形框", altDigit: 1, group: "static" },
  { id: "track", hotkey: "T", label: "轨迹", icon: "target", desc: "跨帧对象轨迹", altDigit: 2, group: "track" },
  { id: "hand", hotkey: "V", label: "平移", icon: "move", desc: "拖拽平移画布", altDigit: 3, group: "view" },
];

// v0.13.3-5 · 点云 3D 工具:select 拾取选中 / box 点地面放置。view 控件(点大小/重置)留视口 HUD。
const THREE_D_TOOLS: Array<{ id: ThreeDTool; hotkey: string; label: string; icon: IconName; desc: string }> = [
  { id: "select", hotkey: "V", label: "选择", icon: "move", desc: "拾取 / 选中 3D 框" },
  { id: "box", hotkey: "B", label: "放置框", icon: "rect", desc: "点地面放置新 3D 框" },
];

const cn = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

/**
 * v0.10.2 · 左侧垂直工具栏 (Prompt-first 重构).
 *
 * 工具分组:
 *   普通绘制: box, polygon
 *   ─── 分隔 ───
 *   AI 工具 (按 prompt 范式): smart-point, smart-box, text-prompt, exemplar
 *     每个工具声明 requiredPrompt; backend 不支持时按钮置灰 + tooltip 提示.
 *     任一 AI 工具激活时, 其右侧抽屉显示 AIToolDrawer (后端 + 参数 + 工具控件).
 *   ─── 分隔 ───
 *   视图: hand
 */
export function ToolDock({
  tool,
  onSetTool,
  videoTool = "box",
  onSetVideoTool,
  isPromptSupported,
  capabilitiesLoading = false,
  aiToolDrawer,
  reviewMode = false,
  videoMode = false,
  enabledToolUnits = null,
  videoModes = null,
  threeDMode = false,
  threeDTool = "select",
  onSetThreeDTool,
}: ToolDockProps) {
  if (threeDMode) {
    return (
      <div className={styles.root} data-workbench-tool-dock>
        {THREE_D_TOOLS.map((t) => {
          const active = threeDTool === t.id;
          return (
            <Tooltip key={t.id} name={t.label} desc={t.desc} hotkey={t.hotkey} side="right" delay={250}>
              <button
                type="button"
                onClick={() => onSetThreeDTool?.(t.id)}
                aria-label={t.label}
                aria-pressed={active}
                data-testid={`three-d-tool-btn-${t.id}`}
                className={cn(styles.toolButton, active && styles.toolButtonActive)}
              >
                <Icon name={t.icon} size={17} />
                <span aria-hidden className={cn(styles.hotkeyBadge, active && styles.hotkeyBadgeActive)}>
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
    // hand (view) 恒显示; box/track 按 video_modes 过滤 (null = 兼容老项目, 全显示)。
    const visibleVideoTools = VIDEO_TOOLS.filter((t) => {
      if (t.group === "view") return true;
      if (!videoModes) return true;
      if (t.id === "box") return videoModes.box;
      if (t.id === "track") return videoModes.track;
      return true;
    });
    return (
      <div className={styles.root} data-workbench-tool-dock>
        {visibleVideoTools.map((t, idx) => {
          const active = videoTool === t.id;
          const prevGroup = idx > 0 ? visibleVideoTools[idx - 1].group : null;
          const showDivider = prevGroup !== null && prevGroup !== t.group;
          return (
            <Fragment key={t.id}>
              {showDivider && <div aria-hidden className={styles.divider} />}
              <Tooltip
                name={t.label}
                desc={`${t.desc} · 备用 Alt+${t.altDigit}`}
                hotkey={t.hotkey}
                side="right"
                delay={250}
              >
                <button
                  type="button"
                  onClick={() => onSetVideoTool?.(t.id)}
                  aria-label={t.label}
                  aria-pressed={active}
                  data-testid={`video-tool-btn-${t.id}`}
                  className={cn(styles.toolButton, active && styles.toolButtonActive)}
                >
                  <Icon name={t.icon} size={17} />
                  <span aria-hidden className={cn(styles.hotkeyBadge, active && styles.hotkeyBadgeActive)}>
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

  const visibleTools = reviewMode
    ? ALL_TOOLS.filter((t) => t.id === "hand")
    : ALL_TOOLS.filter((t) => {
        // hand (视图) 与 AI 工具 (requiredPrompt, 按后端能力置灰) 不受 tool_bindings 过滤。
        if (t.id === "hand" || t.requiredPrompt) return true;
        // 老项目无 tool_bindings → enabledToolUnits 为 null → 全显示 (向后兼容)。
        if (!enabledToolUnits) return true;
        return enabledToolUnits.has(toolUnitForTool(t.id));
      });

  // 分组分隔: 普通绘制 → AI 工具 → 视图工具
  const isAITool = (t: CanvasTool) => !!t.requiredPrompt;
  const groupOf = (t: CanvasTool): "draw" | "ai" | "view" =>
    t.id === "hand" ? "view" : isAITool(t) ? "ai" : "draw";

  return (
    <div className={styles.root} data-workbench-tool-dock>
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
              <div aria-hidden className={styles.divider} />
            )}
            <div className={styles.toolWrap}>
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
                    styles.toolButton,
                    active && styles.toolButtonActive,
                    disabled && styles.toolButtonDisabled,
                  )}
                >
                  <Icon name={t.icon as IconName} size={17} />
                  <span
                    aria-hidden
                    className={cn(styles.hotkeyBadge, active && styles.hotkeyBadgeActive)}
                  >
                    {t.hotkey.toUpperCase()}
                  </span>
                </button>
              </Tooltip>
              {/* AIToolDrawer 在 AI 工具激活时挂在该按钮右侧 */}
              {active && isAITool(t) && aiToolDrawer && (
                <div className={styles.aiDrawerSlot}>
                  {aiToolDrawer}
                </div>
              )}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
