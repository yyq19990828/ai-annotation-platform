import { apiClient } from "./client";

export interface BucketSummary {
  name: string;
  status: "ok" | "error";
  object_count: number;
  total_size_bytes: number;
  error: string | null;
  role: "annotations" | "datasets";
}

export interface StorageOverview {
  items: BucketSummary[];
  total_object_count: number;
  total_size_bytes: number;
}

export interface MLBackendItem {
  id: string;
  project_id: string;
  name: string;
  url: string;
  state: string;
  is_interactive: boolean;
  auth_method: string;
  extra_params: Record<string, unknown>;
  error_message: string | null;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectMLBackendsGroup {
  project_id: string;
  project_name: string;
  backends: MLBackendItem[];
}

export interface MLIntegrationsOverview {
  storage: StorageOverview;
  projects: ProjectMLBackendsGroup[];
  total_backends: number;
  connected_backends: number;
}

export const adminMlIntegrationsApi = {
  overview: () =>
    apiClient.get<MLIntegrationsOverview>("/admin/ml-integrations/overview"),
};
