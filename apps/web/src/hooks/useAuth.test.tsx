import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MeResponse } from "../api/auth";
import { useAuthStore } from "../stores/authStore";

const mockAuthApi = vi.hoisted(() => ({
  login: vi.fn(),
  me: vi.fn(),
  logout: vi.fn(),
  logoutAll: vi.fn(),
}));

vi.mock("../api/auth", () => ({
  authApi: mockAuthApi,
}));

import { useLogin } from "./useAuth";

const fakeUser: MeResponse = {
  id: "1",
  email: "admin@example.com",
  name: "Admin",
  role: "super_admin",
  group_name: null,
  status: "active",
  created_at: "2026-05-10T00:00:00Z",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("useLogin", () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({ token: null, user: null });
    vi.clearAllMocks();
  });

  it("does not expose a token-only auth state while /auth/me is loading", async () => {
    const me = deferred<MeResponse>();
    mockAuthApi.login.mockResolvedValue({ access_token: "jwt", token_type: "bearer" });
    mockAuthApi.me.mockReturnValue(me.promise);

    const { result } = renderHook(() => useLogin(), { wrapper });

    act(() => {
      result.current.mutate({ email: "admin", password: "123456" });
    });

    await waitFor(() => expect(mockAuthApi.me).toHaveBeenCalled());
    expect(localStorage.getItem("token")).toBe("jwt");
    expect(useAuthStore.getState()).toMatchObject({ token: null, user: null });

    act(() => {
      me.resolve(fakeUser);
    });

    await waitFor(() =>
      expect(useAuthStore.getState()).toMatchObject({ token: "jwt", user: fakeUser }),
    );
  });

  it("clears the temporary token if /auth/me fails", async () => {
    mockAuthApi.login.mockResolvedValue({ access_token: "jwt", token_type: "bearer" });
    mockAuthApi.me.mockRejectedValue(new Error("me failed"));

    const { result } = renderHook(() => useLogin(), { wrapper });

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({ email: "admin", password: "123456" });
      } catch (err) {
        caught = err;
      }
    });

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("me failed");
    expect(localStorage.getItem("token")).toBeNull();
    expect(useAuthStore.getState()).toMatchObject({ token: null, user: null });
  });
});
