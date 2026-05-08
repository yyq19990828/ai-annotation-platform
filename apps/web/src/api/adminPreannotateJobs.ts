import { apiClient } from "./client";
import type {
  PredictionJobOut as PredictionJobOutGen,
  PredictionJobsResponse as PredictionJobsResponseGen,
} from "./generated/types.gen";

/** v0.9.8 · prediction_jobs 完整历史 (与 /admin/preannotate-queue 区分).
 *
 * status 在后端是 Literal["running","completed","failed"], openapi-ts codegen
 * 把 Literal 折成 string. 这里收紧成 union 给前端调用方更强的类型保护. */
export type PredictionJobStatus = "running" | "completed" | "failed";

export type PredictionJobOut = Omit<PredictionJobOutGen, "status"> & {
  status: PredictionJobStatus;
};

export type PredictionJobsResponse = Omit<PredictionJobsResponseGen, "items"> & {
  items: PredictionJobOut[];
};

export interface ListJobsParams {
  project_id?: string;
  status?: PredictionJobStatus;
  from?: string;
  to?: string;
  search?: string;
  cursor?: string;
  limit?: number;
}

export const adminPreannotateJobsApi = {
  list: (params: ListJobsParams = {}) => {
    const qs = new URLSearchParams();
    if (params.project_id) qs.set("project_id", params.project_id);
    if (params.status) qs.set("status", params.status);
    if (params.from) qs.set("from", params.from);
    if (params.to) qs.set("to", params.to);
    if (params.search) qs.set("search", params.search);
    if (params.cursor) qs.set("cursor", params.cursor);
    if (params.limit !== undefined) qs.set("limit", String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return apiClient.get<PredictionJobsResponse>(
      `/admin/preannotate-jobs${suffix}`,
    );
  },
};
