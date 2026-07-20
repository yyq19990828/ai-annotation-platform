/**
 * v0.23.4 P3 · shared prop shapes passed from the registry orchestrator
 * (`RegisteredBackendsTab`) to the four section components under `registry/`.
 *
 * The orchestrator owns the queries and the view-model merge (plan §10); each
 * section is a presentational receiver. Keeping these shapes in one place lets
 * the section components stay focused on rendering without re-deriving the
 * pool/member/GPU cross-references.
 */
import type { ComponentType } from "react";

import type {
  GPUArbiterResourceItem,
  GlobalBackendItem,
  MLIntegrationsOverview,
} from "@/api/adminMlIntegrations";
import type {
  ServicePoolAdminItem,
  TopologyResponse,
} from "@/api/generated/types.gen";
import type {
  Diagnostic,
  RuntimeTopologyViewModel,
} from "../runtimeTopology";

/** Search + status filter state shared by every section that has a header row. */
export interface RegistryFilters {
  search: string;
  statusFilter: "all" | "healthy" | "degraded" | "offline" | "unknown";
}

/** Static once-per-render bundle the orchestrator hands to sections. */
export interface RegistryScope {
  /** True for SUPER_ADMIN. Project Admin sees a trimmed, read-only view. */
  isSuperAdmin: boolean;
  /** Topology view model (pools with merged runtime snapshot). */
  vm: RuntimeTopologyViewModel;
  /** Raw topology (used by Issue Center for affected-member lookups). */
  topology: TopologyResponse;
  /** Service-pool admin list (Super Admin only; undefined for Project Admin). */
  servicePools: ServicePoolAdminItem[] | null;
  /** Global backend registry (super-admin: with GPU config; project admin: GPU-nulled). */
  backends: GlobalBackendItem[];
  /** GPU arbiter resources (Super Admin only). */
  gpuResources: GPUArbiterResourceItem[] | null;
  /** Overview (project bindings; Super Admin only). */
  overview: MLIntegrationsOverview | null;
  /** Deduped diagnostics for the Issue Center and severity badges. */
  diagnostics: Diagnostic[];
  /** Router mode (topology-side; always present). */
  routerMode: RuntimeTopologyViewModel["router_mode"];
}

/** A registry section component takes the shared scope + the filter state. */
export type RegistrySectionComponent = ComponentType<{
  scope: RegistryScope;
  filters: RegistryFilters;
}>;
