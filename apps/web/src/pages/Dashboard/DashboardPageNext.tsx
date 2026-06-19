/**
 * DashboardPageNext —— UI-refactor 实验分支的垂直切片 PoC。
 *
 * 与现网 DashboardPage 并行存在(路由 /dashboard-next),复用同一套数据 hooks
 * (useProjects / useProjectStats / useAuditLogs),仅把视觉层换成 shadcn + Geist tokens,
 * 用来和旧页面左右对比、评估全量迁移是否值得。不接管向导/抽屉等重型交互。
 */
import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  Flag,
  Layers,
  Search,
  SlidersHorizontal,
  Sparkles,
  Upload,
  Plus,
  Activity,
} from "lucide-react";

import { Button } from "@/components/shadcn/ui/button";
import { Badge } from "@/components/shadcn/ui/badge";
import { Input } from "@/components/shadcn/ui/input";
import { Progress } from "@/components/shadcn/ui/progress";
import { Avatar, AvatarFallback } from "@/components/shadcn/ui/avatar";
import { Tabs, TabsList, TabsTrigger } from "@/components/shadcn/ui/tabs";
import { Skeleton } from "@/components/shadcn/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/shadcn/ui/table";

import { useProjects, useProjectStats } from "@/hooks/useProjects";
import { useAuditLogs } from "@/hooks/useAudit";
import type { ProjectResponse } from "@/api/projects";
import { auditActionLabel } from "@/utils/auditLabels";
import { projectDisplayType } from "@/utils/projectDisplay";
import { statTrendFromSeries } from "@/utils/projectStatsSeries";
import { buildWorkbenchUrl, currentWorkbenchReturnTo } from "@/utils/workbenchNavigation";
import { cn } from "@/lib/utils";

const FILTERS = ["全部", "进行中", "待审核", "已完成"] as const;
const FILTER_STATUS_MAP: Record<string, string | undefined> = {
  全部: undefined,
  进行中: "in_progress",
  待审核: "pending_review",
  已完成: "completed",
};
const WORKBENCH_PROJECT_TYPES = new Set(["image-det", "video-track", "lidar"]);

function TrendChip({ value }: { value: number }) {
  if (value === 0) return <span className="text-xs text-muted-foreground">持平</span>;
  const up = value > 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-medium tabular-nums",
        up
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-rose-600 dark:text-rose-400",
      )}
    >
      {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
      {Math.abs(value)}%
    </span>
  );
}

/** 每张统计卡一个柔色图标片(参考 AnnotatePro)：中性底 + 彩色点缀 */
const STAT_TINTS = {
  sky: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
} as const;

function StatCard({
  icon: Icon,
  label,
  value,
  trend,
  caption,
  tint,
}: {
  icon: typeof Layers;
  label: string;
  value: string;
  trend?: number;
  caption: string;
  tint: keyof typeof STAT_TINTS;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 transition-colors hover:border-border/70">
      <div className="flex items-start justify-between">
        <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
        <div className={cn("flex size-9 items-center justify-center rounded-full", STAT_TINTS[tint])}>
          <Icon className="size-[18px]" />
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-3xl font-semibold tracking-tight tabular-nums">{value}</span>
        {trend !== undefined && <TrendChip value={trend} />}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{caption}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    in_progress: {
      label: "进行中",
      className: "border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    },
    completed: {
      label: "已完成",
      className: "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    },
    pending_review: {
      label: "待审核",
      className: "border-sky-500/25 bg-sky-500/10 text-sky-600 dark:text-sky-400",
    },
  };
  const m = map[status];
  if (!m) return <span className="text-sm text-muted-foreground">—</span>;
  return (
    <Badge variant="outline" className={cn("gap-1.5 rounded-full font-medium", m.className)}>
      <span className="size-1.5 rounded-full bg-current" />
      {m.label}
    </Badge>
  );
}

function ProjectRow({
  p,
  onOpen,
}: {
  p: ProjectResponse;
  onOpen: (p: ProjectResponse) => void;
}) {
  const total = p.total_tasks || 1;
  const pct = Math.round((p.completed_tasks / total) * 100);
  const ownerInitial = (p.owner_name?.slice(0, 1) ?? "?").toUpperCase();
  const updated = p.updated_at ? new Date(p.updated_at).toLocaleDateString("zh-CN") : "—";

  return (
    <TableRow className="group cursor-pointer" onClick={() => onOpen(p)}>
      <TableCell>
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-md border border-border bg-secondary text-muted-foreground">
            <Layers className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate font-medium text-foreground">{p.name}</div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="font-mono">{p.display_id}</span>
              <span>·</span>
              <span>{projectDisplayType(p)}</span>
            </div>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Avatar className="size-7">
            <AvatarFallback className="bg-secondary text-xs text-secondary-foreground">
              {ownerInitial}
            </AvatarFallback>
          </Avatar>
          <span className="text-sm text-foreground">{p.owner_name ?? "—"}</span>
        </div>
      </TableCell>
      <TableCell className="w-[200px]">
        <div className="flex items-center justify-between text-xs">
          <span className="font-mono text-muted-foreground">
            {p.completed_tasks.toLocaleString()} / {p.total_tasks.toLocaleString()}
          </span>
          <span className="font-medium tabular-nums text-foreground">{pct}%</span>
        </div>
        <Progress
          value={pct}
          className="mt-1.5 h-1.5 [&>*]:bg-emerald-500 dark:[&>*]:bg-emerald-400"
        />
      </TableCell>
      <TableCell>
        {p.ai_enabled ? (
          <Badge
            variant="outline"
            className="gap-1 border-violet-500/25 bg-violet-500/10 text-violet-600 dark:text-violet-400"
          >
            <Sparkles className="size-3" />
            {p.ml_backend_id ? "已接入" : "未接入"}
          </Badge>
        ) : (
          <span className="text-sm text-muted-foreground">未启用</span>
        )}
      </TableCell>
      <TableCell>
        <StatusBadge status={p.status} />
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">{updated}</TableCell>
      <TableCell className="text-right">
        <Button
          size="sm"
          variant="ghost"
          className="opacity-0 transition-opacity group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(p);
          }}
        >
          打开 <ChevronRight className="size-3.5" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

export function DashboardPageNext() {
  const [filter, setFilter] = useState<string>("全部");
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const location = useLocation();

  const { data: projects = [], isLoading } = useProjects({
    status: FILTER_STATUS_MAP[filter],
    search: query || undefined,
  });
  const { data: stats } = useProjectStats();
  const { data: audit } = useAuditLogs({ page: 1, page_size: 8 });
  const recentActivity = useMemo(
    () => (audit?.items ?? []).filter((it) => !it.action.startsWith("http.")).slice(0, 6),
    [audit],
  );

  const onOpenProject = (p: ProjectResponse) => {
    if (WORKBENCH_PROJECT_TYPES.has(p.type_key)) {
      navigate(buildWorkbenchUrl(p.id, { returnTo: currentWorkbenchReturnTo(location) }));
    }
  };

  return (
    <div className="tw-scope min-h-full bg-background px-8 py-7 text-foreground">
      {/* 页头 */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">项目总览</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            管理你的标注项目,跟踪进度与 AI 辅助效率
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm">
            <Upload className="size-4" />
            导入数据集
          </Button>
          <Button size="sm" onClick={() => navigate("/?new=1")}>
            <Plus className="size-4" />
            新建项目
          </Button>
        </div>
      </div>

      {/* 统计卡 */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Layers}
          tint="sky"
          label="任务总量"
          value={(stats?.total_data ?? 0).toLocaleString()}
          trend={statTrendFromSeries(stats?.total_data_series)}
          caption="全部标注任务"
        />
        <StatCard
          icon={CheckCircle2}
          tint="emerald"
          label="已完成任务"
          value={(stats?.completed ?? 0).toLocaleString()}
          trend={statTrendFromSeries(stats?.completed_series)}
          caption="较上一周期"
        />
        <StatCard
          icon={Sparkles}
          tint="violet"
          label="AI 派生标注率"
          value={`${stats?.ai_rate ?? 0}%`}
          trend={statTrendFromSeries(stats?.ai_rate_series)}
          caption="AI 辅助覆盖占比"
        />
        <StatCard
          icon={Flag}
          tint="amber"
          label="待审核任务"
          value={(stats?.pending_review ?? 0).toLocaleString()}
          trend={statTrendFromSeries(stats?.pending_review_series)}
          caption="等待质检通过"
        />
      </div>

      {/* 项目表 */}
      <div className="mt-6 rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <div className="flex items-center gap-4">
            <h2 className="text-base font-semibold">我的项目</h2>
            <Tabs value={filter} onValueChange={setFilter}>
              <TabsList>
                {FILTERS.map((f) => (
                  <TabsTrigger key={f} value={f}>
                    {f}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="搜索项目..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-9 w-56 pl-8"
              />
            </div>
            <Button variant="outline" size="sm">
              <SlidersHorizontal className="size-4" />
              筛选
            </Button>
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>项目</TableHead>
              <TableHead>负责人</TableHead>
              <TableHead>进度</TableHead>
              <TableHead>AI 模型</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>更新</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading &&
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i} className="hover:bg-transparent">
                  <TableCell colSpan={7}>
                    <Skeleton className="h-9 w-full" />
                  </TableCell>
                </TableRow>
              ))}
            {!isLoading &&
              projects.map((p) => <ProjectRow key={p.id} p={p} onOpen={onOpenProject} />)}
            {!isLoading && projects.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={7} className="h-24 text-center text-sm text-muted-foreground">
                  没有匹配的项目
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* 底部双卡 */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-base font-semibold">AI 预标注队列</h3>
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400">
              <Sparkles className="size-6" />
            </div>
            <div className="text-sm text-foreground">暂无运行中的预标注任务</div>
            <div className="text-xs text-muted-foreground">
              在标注工作台中点击「AI 一键预标」启动
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-base font-semibold">近期活动</h3>
          {recentActivity.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <Activity className="size-7 text-muted-foreground/50" />
              <div className="text-sm text-muted-foreground">暂无业务事件</div>
            </div>
          ) : (
            <ul className="mt-3 space-y-3">
              {recentActivity.map((it) => (
                <li key={it.id} className="flex items-center gap-3">
                  <Avatar className="size-7">
                    <AvatarFallback className="bg-secondary text-xs text-secondary-foreground">
                      {(it.actor_email ?? "?").slice(0, 1).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm text-foreground">
                        {it.actor_email ?? "匿名"}
                      </span>
                      <Badge variant="secondary" className="shrink-0 font-normal">
                        {auditActionLabel(it.action)}
                      </Badge>
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {relativeTime(it.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN");
}
