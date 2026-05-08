import React, { forwardRef } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  Bot,
  Box,
  Brain,
  Bug,
  Check,
  CircleDot,
  Clock,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Crosshair,
  Database,
  Download,
  Eye,
  EyeOff,
  Filter,
  Flag,
  Folder,
  FolderOpen,
  Hexagon,
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
  LogOut,
  Menu,
  MessageSquareText,
  Monitor,
  Moon,
  MoreVertical,
  Move,
  Pause,
  PanelLeft,
  PanelRight,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Shield,
  ShieldAlert,
  Sparkle,
  Sparkles,
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

/**
 * 图标体系（v0.5.5）—— 内部走 Lucide React，对外保留稳定的 `<Icon name="..." />` API。
 *
 * 旧约定：~60 个手写 SVG path（视觉一致性 / 像素对齐都要自己保）。
 * 新约定：name → Lucide 组件映射；新代码直接 `import { Layers } from "lucide-react"` 也可以。
 *
 * 这里只为存量 171 处调用兜底兼容；新业务（batch / SAM / theme 等）建议直接用 Lucide。
 */
const ICON_MAP: Record<string, LucideIcon> = {
  activity: Activity,
  bell: Bell,
  bot: Bot,
  box: Box,
  brain: Brain,
  bug: Bug,
  check: Check,
  circleDot: CircleDot,
  clock: Clock,
  chevDown: ChevronDown,
  chevLeft: ChevronLeft,
  chevRight: ChevronRight,
  chevUp: ChevronUp,
  cube: Box,
  dashboard: LayoutDashboard,
  db: Database,
  download: Download,
  edit: Pencil,
  eye: Eye,
  eyeOff: EyeOff,
  filter: Filter,
  flag: Flag,
  folder: Folder,
  folderOpen: FolderOpen,
  grid: LayoutGrid,
  image: ImageIcon,
  inbox: Inbox,
  info: Info,
  key: Key,
  layers: Layers,
  link: LinkIcon,
  list: List,
  loader2: Loader2,
  lock: Lock,
  logout: LogOut,
  menu: Menu,
  messageSquareText: MessageSquareText,
  mm: SquareTerminal,
  monitor: Monitor,
  moon: Moon,
  more: MoreVertical,
  move: Move,
  panelLeft: PanelLeft,
  panelRight: PanelRight,
  pause: Pause,
  play: Play,
  plus: Plus,
  point: Crosshair,
  polygon: Hexagon,
  rect: Square,
  refresh: RefreshCw,
  save: Save,
  search: Search,
  settings: Settings,
  shield: Shield,
  shieldAlert: ShieldAlert,
  sparkle: Sparkle,
  sparkles: Sparkles,
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
};

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
  const Cmp = ICON_MAP[name as string];
  if (!Cmp) return null;
  return (
    <Cmp
      ref={ref}
      width={size}
      height={size}
      strokeWidth={stroke}
      style={{ flexShrink: 0, ...style }}
      className={className}
      aria-hidden="true"
    />
  );
});
