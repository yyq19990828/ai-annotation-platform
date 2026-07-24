/**
 * v0.23.4 P3 · registry "项目绑定" tab (Super Admin only).
 *
 * Plan §6.1 (ProjectBindings spec): default by-project view (project name /
 * bound pools / primary pool / routable instance count / risk), toggle to a
 * by-pool reverse lookup. Read-only — "修改" links to /projects/:id/settings.
 * Alert (warning badge) when an AI-enabled project has 0 routable instances in
 * its pool.
 *
 * Project ↔ pool binding is authoritative (server-side, plan Appendix A.6).
 * Without a per-project pool_id field on overview(), the section derives the
 * relationship from topology: a project is "linked to pool P" if at least one
 * of its enabled backends is a routable member of P. This is a *display*
 * approximation surfaced as such; the authoritative binding lives server-side.
 */
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/shadcn/ui/table";

import { EmptyState, NullCell } from "./registryUi";
import type { RegistryScope } from "./registryTypes";
import type { PoolViewModel } from "../runtimeTopology";

type View = "by-project" | "by-pool";

interface ProjectBinding {
  project_id: string;
  project_name: string;
  pools: PoolViewModel[];
  primaryPool: PoolViewModel | null;
  routableCount: number;
  hasEnabledBackend: boolean;
}

interface PoolBinding {
  pool: PoolViewModel;
  projects: Array<{ project_id: string; project_name: string }>;
}

export function ProjectBindingsSection({ scope }: { scope: RegistryScope }): ReactNode {
  const { overview, vm } = scope;
  const [view, setView] = useState<View>("by-project");

  const projectBindings = useMemo<ProjectBinding[]>(() => {
    if (!overview) return [];
    return overview.projects.map((p) => {
      // Find pools that contain at least one of this project's enabled backends.
      const backendIds = new Set(p.backends.map((b) => b.id));
      const pools = vm.pools.filter((pool) =>
        pool.members.some((m) => backendIds.has(m.registry_id)),
      );
      const routableCount = pools.reduce((sum, pool) => sum + pool.availability.routable, 0);
      // Primary pool heuristic: first pool by routable desc. The authoritative
      // primary lives server-side; we surface this as a display hint.
      const primaryPool =
        pools.slice().sort((a, b) => b.availability.routable - a.availability.routable)[0] ?? null;
      return {
        project_id: p.project_id,
        project_name: p.project_name,
        pools,
        primaryPool,
        routableCount,
        hasEnabledBackend: p.backends.length > 0,
      };
    });
  }, [overview, vm.pools]);

  const poolBindings = useMemo<PoolBinding[]>(() => {
    if (!overview) return [];
    return vm.pools.map((pool) => {
      const memberIds = new Set(pool.members.map((m) => m.registry_id));
      const projects: Array<{ project_id: string; project_name: string }> = [];
      for (const proj of overview.projects) {
        if (proj.backends.some((b) => memberIds.has(b.id))) {
          projects.push({ project_id: proj.project_id, project_name: proj.project_name });
        }
      }
      return { pool, projects };
    });
  }, [overview, vm.pools]);

  if (!overview) {
    return <EmptyState icon="folder" message="项目绑定概览不可用" hint="仅超级管理员可见。" />;
  }

  if (overview.projects.length === 0 && vm.pools.length === 0) {
    return (
      <EmptyState
        icon="folder"
        message="尚无项目启用 AI 或服务池"
        hint="在项目设置里启用 AI 并绑定 backend 后会出现在这里。"
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end gap-2">
        <span className="text-2xs text-muted-foreground">视图</span>
        <Button
          size="sm"
          variant={view === "by-project" ? "primary" : "ghost"}
          onClick={() => setView("by-project")}
        >
          按项目
        </Button>
        <Button
          size="sm"
          variant={view === "by-pool" ? "primary" : "ghost"}
          onClick={() => setView("by-pool")}
        >
          按服务池
        </Button>
      </div>

      {view === "by-project" ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>项目</TableHead>
              <TableHead>绑定服务池</TableHead>
              <TableHead>主服务池</TableHead>
              <TableHead>可用实例</TableHead>
              <TableHead>风险</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projectBindings.map((b) => (
              <ProjectBindingRow key={b.project_id} binding={b} />
            ))}
            {projectBindings.length === 0 && (
              <TableRow>
                <TableCell colSpan={6}>
                  <div className="p-6 text-center text-sm text-muted-foreground">暂无项目绑定</div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>服务池</TableHead>
              <TableHead>可路由实例</TableHead>
              <TableHead>绑定项目</TableHead>
              <TableHead>状态</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {poolBindings.map((b) => (
              <PoolBindingRow key={b.pool.id} binding={b} />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function ProjectBindingRow({ binding }: { binding: ProjectBinding }): ReactNode {
  const hasRisk =
    binding.hasEnabledBackend && binding.routableCount === 0 && binding.pools.length > 0;
  const noPoolButEnabled = binding.hasEnabledBackend && binding.pools.length === 0;
  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{binding.project_name}</span>
          <span className="text-2xs text-muted-foreground">{binding.project_id}</span>
        </div>
      </TableCell>
      <TableCell>
        {binding.pools.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {binding.pools.map((p) => (
              <Badge key={p.id} variant="outline" className="text-2xs">
                {p.name}
              </Badge>
            ))}
          </div>
        ) : (
          <NullCell>未绑定服务池</NullCell>
        )}
      </TableCell>
      <TableCell>
        {binding.primaryPool ? (
          <Badge variant="ai" className="text-2xs">
            {binding.primaryPool.name}
          </Badge>
        ) : (
          <NullCell>—</NullCell>
        )}
      </TableCell>
      <TableCell>
        <span className="text-sm">{binding.routableCount}</span>
      </TableCell>
      <TableCell>
        {hasRisk ? (
          <Badge variant="danger">
            <Icon name="alert-triangle" size={11} />
            <span>池内无可路由实例</span>
          </Badge>
        ) : noPoolButEnabled ? (
          <Badge variant="warning">
            <Icon name="alert-triangle" size={11} />
            <span>已启用 backend 但未纳管到服务池</span>
          </Badge>
        ) : (
          <NullCell>—</NullCell>
        )}
      </TableCell>
      <TableCell className="text-right">
        <Link
          to={`/projects/${binding.project_id}/settings?section=ml-backends`}
          className="whitespace-nowrap text-xs text-brand no-underline hover:underline"
        >
          打开项目设置 →
        </Link>
      </TableCell>
    </TableRow>
  );
}

function PoolBindingRow({ binding }: { binding: PoolBinding }): ReactNode {
  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{binding.pool.name}</span>
          <span className="text-2xs text-muted-foreground">{binding.pool.id}</span>
        </div>
      </TableCell>
      <TableCell>
        <span className="text-sm">
          <span className="text-status-positive">{binding.pool.availability.routable}</span>
          <span className="text-muted-foreground"> / {binding.pool.availability.total}</span>
        </span>
      </TableCell>
      <TableCell>
        {binding.projects.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {binding.projects.map((p) => (
              <Badge key={p.project_id} variant="outline" className="text-2xs">
                {p.project_name}
              </Badge>
            ))}
          </div>
        ) : (
          <NullCell>无项目绑定</NullCell>
        )}
      </TableCell>
      <TableCell>
        <Badge
          variant={
            binding.pool.status === "offline"
              ? "danger"
              : binding.pool.status === "degraded"
                ? "warning"
                : binding.pool.status === "healthy"
                  ? "success"
                  : "outline"
          }
        >
          {binding.pool.status}
        </Badge>
      </TableCell>
    </TableRow>
  );
}
