import React, { forwardRef } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bell,
  BookOpen,
  Bot,
  Box,
  Brain,
  Bug,
  Check,
  CheckCircle,
  CircleDot,
  Clock,
  ClipboardPaste,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Crosshair,
  Cpu,
  Database,
  Diamond,
  Download,
  Eye,
  EyeOff,
  Filter,
  Flag,
  Film,
  Flame,
  Folder,
  FolderOpen,
  Hexagon,
  History,
  Image as ImageIcon,
  Inbox,
  Info,
  Key,
  LayoutDashboard,
  LayoutGrid,
  Layers,
  Link as LinkIcon,
  List,
  Loader2,
  Lock,
  LockOpen,
  LogOut,
  Menu,
  MessageSquareText,
  MessageCircle,
  Monitor,
  Moon,
  MoreVertical,
  Move,
  Pause,
  PanelLeft,
  PanelRight,
  Pencil,
  PictureInPicture,
  PictureInPicture2,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Scan,
  Scissors,
  Search,
  Settings,
  Shield,
  ShieldAlert,
  Sparkle,
  Sparkles,
  Spline,
  Square,
  SquareTerminal,
  Sun,
  Tag,
  Target,
  Trash2,
  Type,
  Upload,
  User,
  Users,
  Video,
  WandSparkles,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

import { useElementStyle } from "./useElementStyle";

/**
 * 图标体系（v0.5.5）—— 内部走 Lucide React，对外保留稳定的 `<Icon name="..." />` API。
 *
 * 旧约定：~60 个手写 SVG path（视觉一致性 / 像素对齐都要自己保）。
 * 新约定：name → Lucide 组件映射；新代码直接 `import { Layers } from "lucide-react"` 也可以。
 *
 * 这里只为存量 171 处调用兜底兼容；新业务（batch / SAM / theme 等）建议直接用 Lucide。
 */
const ICON_MAP = {
  activity: Activity,
  "alert-triangle": AlertTriangle,
  arrowRight: ArrowRight,
  bell: Bell,
  // v0.10.13 · E1 · 标注指引图标
  book: BookOpen,
  bot: Bot,
  box: Box,
  brain: Brain,
  bug: Bug,
  check: Check,
  checkCircle: CheckCircle,
  circleDot: CircleDot,
  clock: Clock,
  clipboardPaste: ClipboardPaste,
  chevDown: ChevronDown,
  chevLeft: ChevronLeft,
  chevRight: ChevronRight,
  chevUp: ChevronUp,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  crosshair: Crosshair,
  cube: Box,
  copy: Copy,
  cpu: Cpu,
  dashboard: LayoutDashboard,
  db: Database,
  diamond: Diamond,
  download: Download,
  edit: Pencil,
  eye: Eye,
  eyeOff: EyeOff,
  film: Film,
  filter: Filter,
  flag: Flag,
  flame: Flame,
  folder: Folder,
  folderOpen: FolderOpen,
  grid: LayoutGrid,
  history: History,
  image: ImageIcon,
  inbox: Inbox,
  info: Info,
  key: Key,
  layers: Layers,
  link: LinkIcon,
  list: List,
  loader2: Loader2,
  lock: Lock,
  unlock: LockOpen,
  logout: LogOut,
  menu: Menu,
  messageSquareText: MessageSquareText,
  messageCircle: MessageCircle,
  mm: SquareTerminal,
  monitor: Monitor,
  moon: Moon,
  more: MoreVertical,
  move: Move,
  panelLeft: PanelLeft,
  panelRight: PanelRight,
  pictureInPicture: PictureInPicture,
  pictureInPicture2: PictureInPicture2,
  pause: Pause,
  play: Play,
  plus: Plus,
  point: Crosshair,
  polygon: Hexagon,
  rect: Square,
  refresh: RefreshCw,
  "rotate-ccw": RotateCcw,
  save: Save,
  scan: Scan,
  scissors: Scissors,
  search: Search,
  settings: Settings,
  shield: Shield,
  shieldAlert: ShieldAlert,
  sparkle: Sparkle,
  sparkles: Sparkles,
  spline: Spline,
  sun: Sun,
  tag: Tag,
  target: Target,
  trash: Trash2,
  type: Type,
  upload: Upload,
  user: User,
  users: Users,
  video: Video,
  wandSparkles: WandSparkles,
  warning: AlertTriangle,
  x: X,
  zoomIn: ZoomIn,
  zoomOut: ZoomOut,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICON_MAP;

interface IconProps {
  name: IconName;
  size?: number;
  /** 与旧手写 SVG 接口一致：默认 1.6 */
  stroke?: number;
  style?: React.CSSProperties;
  className?: string;
}

export const Icon = forwardRef<SVGSVGElement, IconProps>(function Icon(
  { name, size = 16, stroke = 1.6, style, className },
  ref,
) {
  const styleRef = useElementStyle(style, ref);
  const Cmp = ICON_MAP[name];
  if (!Cmp) return null;
  return (
    <Cmp
      ref={styleRef}
      width={size}
      height={size}
      strokeWidth={stroke}
      className={cn("shrink-0", className)}
      aria-hidden="true"
    />
  );
});
