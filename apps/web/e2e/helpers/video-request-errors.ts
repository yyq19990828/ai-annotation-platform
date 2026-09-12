export interface VideoRequestError {
  kind: string;
  message: string;
  method?: string;
  path?: string;
}

/** Only known lifecycle cancellations are expected; write failures and HTTP errors remain errors. */
export function isVideoLifecycleCancellation(error: VideoRequestError): boolean {
  if (error.kind !== "request" || error.message !== "net::ERR_ABORTED" || !error.path) return false;
  if (error.method === "POST")
    return ["/api/v1/auth/me/heartbeat", "/api/v1/auth/me/task-events:batch"].includes(error.path);
  if (error.method !== "GET") return false;
  return (
    error.path === "/api/v1/auth/me" ||
    error.path === "/api/v1/feedbacks" ||
    error.path === "/api/v1/tasks" ||
    /^\/api\/v1\/tasks\/[0-9a-f-]{36}$/.test(error.path) ||
    // Leaving the comments tab retires its abortable task-discussion query.
    /^\/api\/v1\/tasks\/[0-9a-f-]{36}\/discussion\/page$/.test(error.path) ||
    // Retiring the task also cancels its annotation comment badge query.
    /^\/api\/v1\/tasks\/[0-9a-f-]{36}\/discussion\/annotation-counts$/.test(error.path) ||
    // Closing/replacing an Issue detail retires its root-bound thread query.
    /^\/api\/v1\/feedbacks\/[0-9a-f-]{36}\/thread$/.test(error.path) ||
    /^\/api\/v1\/tasks\/[0-9a-f-]{36}\/video\/frames\/\d+$/.test(error.path) ||
    /^\/api\/v1\/videos\/[0-9a-f-]{36}\/chunks\/\d+(?:\/samples)?$/.test(error.path)
  );
}
