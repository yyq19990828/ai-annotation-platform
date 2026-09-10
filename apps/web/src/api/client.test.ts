import { describe, expect, it, vi } from "vitest";

import { apiClient, apiErrorDetailMessage } from "./client";
import { useAuthStore } from "../stores/authStore";
import type { MeResponse } from "./auth";

describe("apiErrorDetailMessage", () => {
  it("提取 FastAPI 请求体校验错误的字段路径", () => {
    expect(
      apiErrorDetailMessage([
        {
          type: "string_type",
          loc: ["body", "candidate", "candidate", "value", "masklabels", 0],
          msg: "Input should be a valid string",
        },
      ]),
    ).toBe("candidate.candidate.value.masklabels.0：Input should be a valid string");
  });

  it("保持字符串和结构化 message 错误兼容", () => {
    expect(apiErrorDetailMessage("plain error")).toBe("plain error");
    expect(apiErrorDetailMessage({ message: "structured error" })).toBe("structured error");
  });
});

it("never sends another tab's credentials from a stale account UI", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  useAuthStore.getState().setAuth("alice-token", { id: "alice" } as MeResponse);
  localStorage.setItem("token", "bob-token");
  await expect(apiClient.post("/tasks/task/submit")).rejects.toMatchObject({ status: 401 });
  expect(fetch).not.toHaveBeenCalled();
  expect(localStorage.getItem("token")).toBe("bob-token");
  vi.unstubAllGlobals();
  useAuthStore.getState().logout();
});

it("a late 401 does not clear newer credentials", async () => {
  let resolve!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    ),
  );
  localStorage.setItem("token", "old-token");
  const request = apiClient.get("/auth/me").catch((error: unknown) => error);
  localStorage.setItem("token", "new-token");
  useAuthStore.setState({ token: "new-token" });
  resolve(new Response(JSON.stringify({ detail: "expired" }), { status: 401 }));
  await request;
  expect(localStorage.getItem("token")).toBe("new-token");
  expect(useAuthStore.getState().token).toBe("new-token");
  vi.unstubAllGlobals();
  useAuthStore.getState().logout();
});
