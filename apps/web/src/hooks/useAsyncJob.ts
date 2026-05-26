import { useQuery } from "@tanstack/react-query";
import { asyncJobsApi, type AsyncJob } from "@/api/asyncJobs";

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

export function useAsyncJob(jobId: string | null | undefined, poll = false) {
  return useQuery({
    queryKey: ["async-job", jobId],
    queryFn: () => asyncJobsApi.get(jobId!),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const job = query.state.data as AsyncJob | undefined;
      if (!poll || (job && TERMINAL.has(job.status))) return false;
      return 1500;
    },
  });
}
