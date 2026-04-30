/** 自动捕获工具：API 调用 ring buffer + console 错误 ring buffer + 脱敏。 */

interface ApiCallEntry {
  method: string;
  url: string;
  status: number;
  ms: number;
}

interface ConsoleErrorEntry {
  msg: string;
  stack?: string;
}

const MAX_API_CALLS = 10;
const MAX_CONSOLE_ERRORS = 5;

const apiCallRing: ApiCallEntry[] = [];
const consoleErrorRing: ConsoleErrorEntry[] = [];

export function initBugReportCapture() {

  // Capture console errors
  const origOnerror = window.onerror;
  window.onerror = (message, source, lineno, colno, error) => {
    consoleErrorRing.push({
      msg: String(message),
      stack: error instanceof Error ? error.stack?.slice(0, 500) : undefined,
    });
    if (consoleErrorRing.length > MAX_CONSOLE_ERRORS) consoleErrorRing.shift();
    if (origOnerror) origOnerror(message, source, lineno, colno, error);
  };

  const origUnhandled = window.onunhandledrejection;
  window.onunhandledrejection = ((event: PromiseRejectionEvent) => {
    consoleErrorRing.push({
      msg: event.reason instanceof Error ? event.reason.message : String(event.reason),
      stack: event.reason instanceof Error ? event.reason.stack?.slice(0, 500) : undefined,
    });
    if (consoleErrorRing.length > MAX_CONSOLE_ERRORS) consoleErrorRing.shift();
    if (origUnhandled) origUnhandled.call(window, event);
  }) as typeof window.onunhandledrejection;
}

export function getRecentApiCalls(): ApiCallEntry[] {
  return [...apiCallRing];
}

export function getRecentConsoleErrors(): ConsoleErrorEntry[] {
  return [...consoleErrorRing];
}

/**
 * Sanitize API calls: strip auth headers, password fields.
 */
export function sanitizeApiCalls(calls: ApiCallEntry[]): ApiCallEntry[] {
  return calls.map((c) => ({
    ...c,
    url: c.url.replace(/([?&](?:token|password|secret)=)[^&]+/gi, "$1***"),
  }));
}

/**
 * Hook into the app's fetch to record API calls. Call once at app init.
 */
export function patchFetchForBugCapture() {
  const orig = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const start = Date.now();
    let status = 0;
    try {
      const resp = await orig(input, init);
      status = resp.status;
      return resp;
    } catch {
      status = 0;
      throw new Error("fetch failed");
    } finally {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/api/v1/")) {
        apiCallRing.push({
          method: init?.method ?? "GET",
          url,
          status,
          ms: Date.now() - start,
        });
        if (apiCallRing.length > MAX_API_CALLS) apiCallRing.shift();
      }
    }
  };
}
